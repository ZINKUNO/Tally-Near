//! Merchant registry: a NEAR bond, a rotating Ed25519 menu key and a payout account.
use crate::events::emit;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::Promise;

#[near]
impl Tally {
    /// Register the calling account as a merchant. Attach at least `min_bond` NEAR; it is the
    /// bond that proven fraud or an upheld dispute slashes.
    #[payable]
    pub fn register_merchant(&mut self, name: String, signing_key: PublicKey, payout: AccountId) {
        let id = env::predecessor_account_id();
        require!(!self.merchants.contains_key(&id), "already registered");
        require!(ed25519_bytes(&signing_key).is_some(), "signing_key must be ed25519");
        require!(!name.is_empty() && name.len() <= 64, "name must be 1-64 bytes");
        let bond = env::attached_deposit().as_yoctonear();
        require!(bond >= self.config.min_bond.0, "attach at least min_bond NEAR");
        let now = now_ms();
        self.merchants.insert(
            id.clone(),
            Merchant {
                name: name.clone(),
                signing_key: signing_key.clone(),
                key_history: vec![signing_key],
                payout: payout.clone(),
                bond: U128(bond),
                slashed_total: U128(0),
                registered_at_ms: now,
                payout_changed_at_ms: now,
                key_rotated_at_ms: now,
                bond_unlock_at_ms: None,
                open_disputes: 0,
                sales: 0,
                active: true,
            },
        );
        emit("merchant_registered", json!({ "merchant_id": id, "name": name, "payout": payout, "bond": U128(bond) }));
    }

    #[payable]
    pub fn top_up_bond(&mut self) {
        let id = env::predecessor_account_id();
        let m = self.merchant_mut(&id);
        m.bond = U128(m.bond.0 + env::attached_deposit().as_yoctonear());
        let bond = m.bond;
        emit("bond_topped_up", json!({ "merchant_id": id, "bond": bond }));
    }

    /// Rotate the menu signing key. The old key stays in history: menus it signed can still be
    /// proven fraudulent, but they no longer pay.
    pub fn rotate_signing_key(&mut self, signing_key: PublicKey) {
        require!(ed25519_bytes(&signing_key).is_some(), "signing_key must be ed25519");
        let id = env::predecessor_account_id();
        let m = self.merchant_mut(&id);
        m.signing_key = signing_key.clone();
        if !m.key_history.contains(&signing_key) {
            m.key_history.push(signing_key.clone());
        }
        m.key_rotated_at_ms = now_ms();
        emit("signing_key_rotated", json!({ "merchant_id": id, "signing_key": signing_key }));
    }

    /// Change where sales are paid. The Guard warns about this payout for 24 hours, so a
    /// hijacked merchant account can't silently redirect agent payments.
    pub fn set_payout(&mut self, payout: AccountId) {
        let id = env::predecessor_account_id();
        let m = self.merchant_mut(&id);
        m.payout = payout.clone();
        m.payout_changed_at_ms = now_ms();
        emit("payout_changed", json!({ "merchant_id": id, "payout": payout }));
    }

    pub fn set_active(&mut self, active: bool) {
        let id = env::predecessor_account_id();
        let m = self.merchant_mut(&id);
        require!(!active || m.bond_unlock_at_ms.is_none(), "bond unlock in progress");
        m.active = active;
        emit("merchant_active", json!({ "merchant_id": id, "active": active }));
    }

    /// Stop selling and start the bond unlock delay.
    pub fn request_bond_unlock(&mut self) {
        let id = env::predecessor_account_id();
        let delay = self.config.bond_unlock_delay_ms;
        let m = self.merchant_mut(&id);
        m.active = false;
        let at = now_ms() + delay;
        m.bond_unlock_at_ms = Some(at);
        emit("bond_unlock_requested", json!({ "merchant_id": id, "unlock_at_ms": at }));
    }

    /// Withdraw bond after the delay, only while no dispute against this merchant is open.
    pub fn withdraw_bond(&mut self, amount: U128) -> Promise {
        let id = env::predecessor_account_id();
        let m = self.merchant_mut(&id);
        let at = m.bond_unlock_at_ms.unwrap_or_else(|| env::panic_str("request_bond_unlock first"));
        require!(now_ms() >= at, "bond still locked");
        require!(m.open_disputes == 0, "open disputes");
        require!(amount.0 > 0 && amount.0 <= m.bond.0, "bad amount");
        m.bond = U128(m.bond.0 - amount.0);
        emit("bond_withdrawn", json!({ "merchant_id": id, "amount": amount }));
        Promise::new(id).transfer(NearToken::from_yoctonear(amount.0))
    }
}

impl Tally {
    pub(crate) fn merchant_mut(&mut self, id: &AccountId) -> &mut Merchant {
        self.merchants.get_mut(id).unwrap_or_else(|| env::panic_str("not a registered merchant"))
    }
}
