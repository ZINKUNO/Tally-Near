//! `pay`: binds an agent's purchase to a merchant-signed catalog leaf, the Guard's verdict and
//! the owner's rules, then settles in one transaction.
//!
//! Checks, in order:
//!  1. capsule not frozen, not expired
//!  2. merchant registered; Guard verdict is not `block` (blocklist, inactive, slashed bond)
//!  3. header rebuilt from typed arguments + this contract's id + the merchant's id, and its
//!     Ed25519 signature verified against the merchant's current menu key
//!  4. freshness: issued <= now <= expires; window <= 10 min, or <= 24 h with `allow_extended`
//!  5. the leaf the contract hashes itself (id, category, price, floor) is in the signed root
//!  6. category allowed, price <= per-purchase cap, rolling 24 h total <= daily cap, balance
//!  7. nullifier (owner, merchant, menu nonce, item) unused
//!  8. Second Look: not the cheapest item in its category, an extended menu, or any Guard warning
//!     needs the owner. Signed by the agent key, the purchase is parked instead of paid.
use crate::events::emit;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use tally_menu::hash::sha256v;
use tally_menu::header::{build_header, HeaderFields};
use tally_menu::menu::{leaf_hash, Item};
use tally_menu::merkle::verify_proof;

pub(crate) struct Checked {
    pub needs_owner: Vec<String>,
    pub guard: Verdict,
    pub nullifier: [u8; 32],
    pub new_spent: u128,
    pub cycle_reset: bool,
}

type Fail = (Reject, String);

pub(crate) fn nullifier(owner: &AccountId, merchant: &AccountId, nonce: u64, item_id: &[u8; 16]) -> [u8; 32] {
    sha256v(&[owner.as_bytes(), &[0], merchant.as_bytes(), &[0], &nonce.to_le_bytes(), item_id])
}

pub(crate) fn nullifier_of(r: &Receipt) -> [u8; 32] {
    nullifier(&r.owner, &r.merchant_id, r.menu_nonce, &hex16(&r.item_id).unwrap_or_default())
}

pub(crate) fn decode_proof(proof: &[String]) -> Option<Vec<[u8; 32]>> {
    proof.iter().map(|p| hex32(p)).collect()
}

impl Tally {
    /// Run every check without changing state. `fresh_at` is the time the menu must have been
    /// valid at (now, or the moment a Second Look was proposed); everything else uses `now`.
    pub(crate) fn check(&self, owner: &AccountId, c: &Capsule, a: &PayArgs, fresh_at: u64, now: u64) -> Result<Checked, Fail> {
        if c.frozen {
            return Err((Reject::Frozen, c.frozen_reason.clone().unwrap_or_else(|| "capsule is frozen".into())));
        }
        if now >= c.rules.expiry_ms {
            return Err((Reject::Expired, "capsule rules have expired".into()));
        }
        let Some(m) = self.merchants.get(&a.merchant_id) else {
            return Err((Reject::UnknownMerchant, format!("{} is not a registered merchant", a.merchant_id)));
        };
        let guard = self.verdict(&a.merchant_id, Some(c), now);
        if guard.level == Level::Block {
            return Err((Reject::GuardBlock, guard.reasons.join("; ")));
        }

        let bad = |what: &str| (Reject::BadArgs, format!("{what} is not valid hex of the right length"));
        let root = hex32(&a.menu_root).ok_or_else(|| bad("menu_root"))?;
        let item_id = hex16(&a.item_id).ok_or_else(|| bad("item_id"))?;
        let sig = hex64(&a.signature).ok_or_else(|| bad("signature"))?;
        let proof = decode_proof(&a.proof).ok_or_else(|| bad("proof"))?;

        let contract_id = env::current_account_id();
        let header = build_header(&HeaderFields {
            contract_id: contract_id.as_str(),
            merchant_id: a.merchant_id.as_str(),
            menu_root: root,
            issued_at_ms: a.issued_at_ms,
            expires_at_ms: a.expires_at_ms,
            menu_nonce: a.menu_nonce,
            item_count: a.item_count,
        });
        let key = ed25519_bytes(&m.signing_key).ok_or((Reject::BadSignature, "merchant key is not ed25519".into()))?;
        if !env::ed25519_verify(&sig, header, &key) {
            return Err((Reject::BadSignature, "menu signature does not match the merchant's registered key".into()));
        }

        if !(a.issued_at_ms <= fresh_at && fresh_at <= a.expires_at_ms) {
            return Err((Reject::Stale, "menu is not valid at this time".into()));
        }
        let window = a.expires_at_ms.saturating_sub(a.issued_at_ms);
        let extended = window > MAX_AUTONOMOUS_WINDOW_MS;
        if window > MAX_EXTENDED_WINDOW_MS || (extended && !c.rules.allow_extended) {
            return Err((Reject::WindowTooLong, format!("menu window of {window} ms is too long for this capsule")));
        }

        let leaf = leaf_hash(&Item { id: item_id, category: a.category, price: a.price.0, floor: a.floor.0 });
        if !verify_proof(leaf, &proof, root) {
            return Err((Reject::NotOnMenu, "this item, at this price, is not on the signed menu".into()));
        }

        if !c.rules.categories.contains(&a.category) {
            return Err((Reject::Category, format!("category {} is not allowed", a.category)));
        }
        if a.price.0 > c.rules.per_tx_cap.0 {
            return Err((Reject::OverPerTx, format!("price {} is over the per-purchase cap {}", a.price.0, c.rules.per_tx_cap.0)));
        }
        let cycle_reset = now.saturating_sub(c.cycle_start_ms) >= CYCLE_MS;
        let spent = if cycle_reset { 0 } else { c.spent_in_cycle.0 };
        let new_spent = spent.checked_add(a.price.0).ok_or((Reject::OverDaily, "overflow".into()))?;
        if new_spent > c.rules.daily_cap.0 {
            return Err((Reject::OverDaily, format!("would spend {new_spent} today, cap is {}", c.rules.daily_cap.0)));
        }
        if a.price.0 > c.balance.0 {
            return Err((Reject::InsufficientBalance, "capsule balance is too low".into()));
        }
        let nul = nullifier(owner, &a.merchant_id, a.menu_nonce, &item_id);
        if self.nullifiers.contains(&nul) {
            return Err((Reject::Duplicate, "this menu item was already paid".into()));
        }

        let mut needs_owner = vec![];
        if a.price.0 > a.floor.0 {
            needs_owner.push(format!("not the cheapest in category {} (floor {})", a.category, a.floor.0));
        }
        if extended {
            needs_owner.push("menu is valid for more than 10 minutes".into());
        }
        if guard.level == Level::Warn {
            needs_owner.extend(guard.reasons.iter().map(|r| format!("guard: {r}")));
        }
        Ok(Checked { needs_owner, guard, nullifier: nul, new_spent, cycle_reset })
    }

    /// Drops this owner's expired Second Looks (rare path: only when the cap is reached).
    /// Returns true when that freed room under the cap.
    fn prune_expired_pending(&mut self, owner: &AccountId, now: u64) -> bool {
        let expired: Vec<u64> = self.pending.values().filter(|p| &p.owner == owner && now > p.expires_at_ms).map(|p| p.id).collect();
        for id in &expired {
            self.pending.remove(id);
            bump(OPEN_PENDING, owner, false);
        }
        counter(OPEN_PENDING, owner) < MAX_OPEN_PENDING
    }

    fn record_strike(&mut self, owner: &AccountId, a: &PayArgs, code: Reject, reason: &str) -> bool {
        let now = now_ms();
        let c = self.capsules.get_mut(owner).expect("capsule");
        c.strikes.retain(|t| now.saturating_sub(*t) < STRIKE_WINDOW_MS);
        c.strikes.push(now);
        if c.strikes.len() > MAX_STRIKES {
            c.strikes.remove(0);
        }
        c.attempts.push(Attempt { at_ms: now, merchant_id: a.merchant_id.clone(), price: a.price, code, reason: reason.into() });
        if c.attempts.len() > MAX_ATTEMPT_LOG {
            c.attempts.remove(0);
        }
        let tripped = !c.frozen && c.rules.tripwire > 0 && c.strikes.len() >= c.rules.tripwire as usize;
        if tripped {
            c.frozen = true;
            c.frozen_reason = Some(format!("tripwire: {} rejected agent attempts within an hour", c.strikes.len()));
        }
        let (frozen, strikes) = (c.frozen, c.strikes.len());
        emit("agent_rejected", json!({ "owner": owner, "merchant_id": a.merchant_id, "price": a.price, "code": code, "reason": reason }));
        if tripped {
            emit("tripwire", json!({ "owner": owner, "strikes": strikes, "frozen": true }));
        }
        frozen
    }

    fn settle(&mut self, owner: &AccountId, a: &PayArgs, k: Checked, cosigned: bool, now: u64) -> u64 {
        let m = self.merchants.get(&a.merchant_id).expect("merchant").clone();
        let c = self.capsules.get_mut(owner).expect("capsule");
        if k.cycle_reset {
            c.cycle_start_ms = now;
        }
        c.spent_in_cycle = U128(k.new_spent);
        c.balance = U128(c.balance.0 - a.price.0);
        c.total_spent = U128(c.total_spent.0 + a.price.0);
        self.nullifiers.insert(k.nullifier);
        let id = self.receipts.len() as u64;
        self.receipts.push(Receipt {
            id,
            owner: owner.clone(),
            merchant_id: a.merchant_id.clone(),
            payout: m.payout.clone(),
            menu_root: a.menu_root.clone(),
            menu_nonce: a.menu_nonce,
            item_id: a.item_id.clone(),
            category: a.category,
            price: a.price,
            floor: a.floor,
            at_ms: now,
            cosigned,
            guard: k.guard,
            memo: short(a.memo.clone()),
            attestation: short(a.attestation.clone()),
            status: ReceiptStatus::Sending,
            evidence_hash: None,
        });
        let mut ids = self.receipts_by_owner.get(owner).cloned().unwrap_or_default();
        ids.push(id);
        self.receipts_by_owner.insert(owner.clone(), ids);
        emit("paid", json!({ "receipt_id": id, "owner": owner, "merchant_id": a.merchant_id, "payout": m.payout, "item_id": a.item_id, "price": a.price, "cosigned": cosigned }));
        bump(INFLIGHT, owner, true);
        // Detached promise: scheduled when dropped; the callback settles or refunds the receipt.
        let _ = token::ft_transfer(self.config.token.clone(), m.payout, a.price, "tally purchase")
            .then(Self::ext(env::current_account_id()).with_static_gas(token::GAS_CALLBACK).on_payout(id));
        id
    }
}

#[near]
impl Tally {
    /// Pay for one item on a merchant-signed menu from the caller's capsule.
    ///
    /// Signed by the capsule's agent key, or relayed as a meta transaction: a rule violation returns
    /// `rejected` (and counts toward the tripwire) instead of panicking; anything that needs the owner
    /// returns `second_look`. Signed directly by any other key of the owner's account: the owner is
    /// paying, so it is co-signed, and a rule violation panics.
    pub fn pay(&mut self, args: PayArgs) -> PayOutcome {
        let owner = env::predecessor_account_id();
        let c = self.capsules.get(&owner).unwrap_or_else(|| env::panic_str("no capsule")).clone();
        // Relayed (NEP-366 meta transaction) or otherwise forwarded: the protocol already checked the
        // delegate signature against a key on the owner's account allowed to call `pay`, but the
        // contract can't see which key. Such calls are always held to the agent's rules.
        let delegated = env::signer_account_id() != owner;
        if delegated {
            require!(c.agent_key.is_some(), "the agent key was revoked");
        }
        let by_agent = delegated || c.agent_key.as_ref() == Some(&env::signer_account_pk());
        let now = now_ms();
        match self.check(&owner, &c, &args, now, now) {
            Err((code, reason)) if by_agent => {
                let frozen = self.record_strike(&owner, &args, code, &reason);
                PayOutcome::Rejected { code, reason, frozen }
            }
            Err((code, reason)) => env::panic_str(&format!("{code:?}: {reason}")),
            Ok(ref k) if by_agent && !k.needs_owner.is_empty() && counter(OPEN_PENDING, &owner) >= MAX_OPEN_PENDING && !self.prune_expired_pending(&owner, now) => {
                let reason = format!("{MAX_OPEN_PENDING} purchases are already waiting for the owner");
                let frozen = self.record_strike(&owner, &args, Reject::TooManyPending, &reason);
                PayOutcome::Rejected { code: Reject::TooManyPending, reason, frozen }
            }
            Ok(k) if by_agent && !k.needs_owner.is_empty() => {
                bump(OPEN_PENDING, &owner, true);
                let id = self.next_pending;
                self.next_pending += 1;
                let reasons = k.needs_owner.clone();
                self.pending.insert(id, Pending {
                    id,
                    owner: owner.clone(),
                    args: args.clone(),
                    reasons: reasons.clone(),
                    guard: k.guard,
                    proposed_at_ms: now,
                    expires_at_ms: now + PENDING_TTL_MS,
                });
                emit("second_look", json!({ "pending_id": id, "owner": owner, "merchant_id": args.merchant_id, "price": args.price, "reasons": reasons }));
                PayOutcome::SecondLook { pending_id: id, reasons }
            }
            Ok(k) => PayOutcome::Paid { receipt_id: self.settle(&owner, &args, k, !by_agent, now) },
        }
    }

    /// Owner approves a Second Look. The menu must have been valid when the agent proposed it;
    /// every other check runs again now.
    pub fn approve(&mut self, pending_id: u64) -> PayOutcome {
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut().clone();
        let p = self.pending.remove(&pending_id).unwrap_or_else(|| env::panic_str("no such pending purchase"));
        require!(p.owner == owner, "not your pending purchase");
        bump(OPEN_PENDING, &owner, false);
        let now = now_ms();
        require!(now <= p.expires_at_ms, "Second Look expired");
        match self.check(&owner, &c, &p.args, p.proposed_at_ms, now) {
            Ok(k) => {
                emit("approved", json!({ "pending_id": pending_id, "owner": owner }));
                PayOutcome::Paid { receipt_id: self.settle(&owner, &p.args, k, true, now) }
            }
            Err((code, reason)) => env::panic_str(&format!("{code:?}: {reason}")),
        }
    }

    /// Owner declines a Second Look ("Was this you?" → no).
    pub fn decline(&mut self, pending_id: u64) {
        let owner = env::predecessor_account_id();
        let _ = self.owner_capsule_mut();
        let p = self.pending.remove(&pending_id).unwrap_or_else(|| env::panic_str("no such pending purchase"));
        require!(p.owner == owner, "not your pending purchase");
        bump(OPEN_PENDING, &owner, false);
        emit("declined", json!({ "pending_id": pending_id, "owner": owner }));
    }
}
