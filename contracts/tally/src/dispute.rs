//! Accountability after the sale: disputes ruled by the arbiter, and floor fraud anyone can prove.
use crate::events::emit;
use crate::pay::decode_proof;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::Promise;
use tally_menu::header::{build_header, HeaderFields};
use tally_menu::menu::{is_floor_contradiction, leaf_hash, Item};
use tally_menu::merkle::verify_proof;

#[near]
impl Tally {
    /// Owner disputes a settled purchase within 7 days, committing to evidence by hash.
    pub fn open_dispute(&mut self, receipt_id: u64, evidence_hash: String) {
        let owner = env::predecessor_account_id();
        let _ = self.owner_capsule_mut();
        require!(hex32(&evidence_hash).is_some(), "evidence_hash must be 32-byte hex");
        let r = self.receipts.get_mut(receipt_id as u32).unwrap_or_else(|| env::panic_str("no such receipt"));
        require!(r.owner == owner, "not your receipt");
        require!(r.status == ReceiptStatus::Settled, "only settled receipts can be disputed");
        require!(now_ms() <= r.at_ms + DISPUTE_WINDOW_MS, "dispute window closed");
        r.status = ReceiptStatus::Disputed;
        r.evidence_hash = Some(evidence_hash.clone());
        let merchant_id = r.merchant_id.clone();
        self.merchant_mut(&merchant_id).open_disputes += 1;
        self.disputes.insert(receipt_id, Dispute {
            receipt_id,
            claimant: owner.clone(),
            merchant_id: merchant_id.clone(),
            evidence_hash: evidence_hash.clone(),
            status: DisputeStatus::Open,
            slashed: U128(0),
            opened_at_ms: now_ms(),
        });
        emit("dispute_opened", json!({ "receipt_id": receipt_id, "owner": owner, "merchant_id": merchant_id, "evidence_hash": evidence_hash }));
    }

    /// Arbiter rules. Upheld: up to `slash` yoctoNEAR of the merchant's bond goes to the claimant,
    /// and with `block` the merchant joins the shared blocklist.
    pub fn resolve_dispute(&mut self, receipt_id: u64, upheld: bool, slash: U128, block: bool) -> Option<Promise> {
        require!(env::predecessor_account_id() == self.config.arbiter, "arbiter only");
        let d = self.disputes.get_mut(&receipt_id).unwrap_or_else(|| env::panic_str("no such dispute"));
        require!(d.status == DisputeStatus::Open, "already resolved");
        let (claimant, merchant_id) = (d.claimant.clone(), d.merchant_id.clone());
        let m = self.merchants.get_mut(&merchant_id).expect("merchant");
        m.open_disputes = m.open_disputes.saturating_sub(1);
        let amount = if upheld { slash.0.min(m.bond.0) } else { 0 };
        m.bond = U128(m.bond.0 - amount);
        m.slashed_total = U128(m.slashed_total.0 + amount);
        let d = self.disputes.get_mut(&receipt_id).expect("dispute");
        d.status = if upheld { DisputeStatus::Upheld } else { DisputeStatus::Rejected };
        d.slashed = U128(amount);
        if let Some(r) = self.receipts.get_mut(receipt_id as u32) {
            r.status = if upheld { ReceiptStatus::DisputeUpheld } else { ReceiptStatus::DisputeRejected };
        }
        if upheld && block {
            self.add_block(merchant_id.clone(), format!("dispute on receipt {receipt_id} upheld"), None);
        }
        emit("dispute_resolved", json!({ "receipt_id": receipt_id, "upheld": upheld, "slashed": U128(amount), "blocked": upheld && block }));
        (amount > 0).then(|| Promise::new(claimant).transfer(NearToken::from_yoctonear(amount)))
    }

    /// Anyone can prove a merchant's signed menu contradicts itself: an item priced below the floor
    /// another item in the same category certifies. Both leaves must be in the same signed root.
    /// The reporter receives `slash_bps` of the bond, and the merchant is blocklisted. One claim
    /// per (merchant, root). Signatures from any key the merchant ever used count.
    #[allow(clippy::too_many_arguments)]
    pub fn prove_floor_fraud(
        &mut self,
        merchant_id: AccountId,
        menu_root: String,
        issued_at_ms: u64,
        expires_at_ms: u64,
        menu_nonce: u64,
        item_count: u32,
        signature: String,
        cheap: LeafProof,
        claimed: LeafProof,
    ) -> Promise {
        let reporter = env::predecessor_account_id();
        let root = hex32(&menu_root).unwrap_or_else(|| env::panic_str("bad menu_root"));
        let sig = hex64(&signature).unwrap_or_else(|| env::panic_str("bad signature"));
        let m = self.merchants.get(&merchant_id).unwrap_or_else(|| env::panic_str("not a registered merchant")).clone();
        let contract_id = env::current_account_id();
        let header = build_header(&HeaderFields {
            contract_id: contract_id.as_str(),
            merchant_id: merchant_id.as_str(),
            menu_root: root,
            issued_at_ms,
            expires_at_ms,
            menu_nonce,
            item_count,
        });
        let signed = m.key_history.iter().filter_map(ed25519_bytes).any(|k| env::ed25519_verify(&sig, header, &k));
        require!(signed, "signature does not match any key this merchant has used");
        let leaf_of = |l: &LeafProof| -> Item {
            Item {
                id: hex16(&l.item_id).unwrap_or_else(|| env::panic_str("bad item_id")),
                category: l.category,
                price: l.price.0,
                floor: l.floor.0,
            }
        };
        let (a, b) = (leaf_of(&cheap), leaf_of(&claimed));
        for (item, lp) in [(&a, &cheap), (&b, &claimed)] {
            let proof = decode_proof(&lp.proof).unwrap_or_else(|| env::panic_str("bad proof"));
            require!(verify_proof(leaf_hash(item), &proof, root), "leaf not in the signed menu");
        }
        require!(is_floor_contradiction(&a, &b), "no contradiction: cheap item is not below the claimed floor");
        let key = tally_menu::hash::sha256v(&[merchant_id.as_bytes(), &root]);
        require!(self.fraud_roots.insert(key), "already proven for this menu");

        let mm = self.merchants.get_mut(&merchant_id).expect("merchant");
        let amount = mm.bond.0 * self.config.slash_bps as u128 / 10_000;
        mm.bond = U128(mm.bond.0 - amount);
        mm.slashed_total = U128(mm.slashed_total.0 + amount);
        mm.active = false;
        self.add_block(merchant_id.clone(), "proven floor fraud on a signed menu".into(), Some(menu_root.clone()));
        emit("floor_fraud", json!({ "merchant_id": merchant_id, "menu_root": menu_root, "reporter": reporter, "slashed": U128(amount) }));
        Promise::new(reporter).transfer(NearToken::from_yoctonear(amount))
    }
}
