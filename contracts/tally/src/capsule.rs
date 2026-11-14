//! Capsules: the owner's rules, the balance the agent may spend, and which key is the agent.
//!
//! Every owner method refuses a call signed by the agent key, even if the owner scoped that key
//! wider than `pay`. The protocol-level restriction (function-call key, method `pay`) is the first
//! wall; this check is the second.
use crate::events::emit;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::Promise;

#[near]
impl Tally {
    /// Open a capsule for the calling account. Attach `capsule_storage` NEAR (refunded on close).
    /// `agent_key` is the public half of the function-call key the agent will sign with.
    #[payable]
    pub fn create_capsule(&mut self, rules: Rules, agent_key: Option<PublicKey>) {
        let owner = env::predecessor_account_id();
        require!(!self.capsules.contains_key(&owner), "capsule exists");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.config.capsule_storage.0, "attach capsule_storage NEAR");
        validate_rules(&rules);
        if let Some(k) = &agent_key {
            require!(k != &env::signer_account_pk(), "agent key must not be the key creating the capsule");
        }
        let now = now_ms();
        self.capsules.insert(
            owner.clone(),
            Capsule {
                agent_key: agent_key.clone(),
                rules: rules.clone(),
                balance: U128(0),
                spent_in_cycle: U128(0),
                cycle_start_ms: now,
                total_spent: U128(0),
                frozen: false,
                frozen_reason: None,
                strikes: vec![],
                attempts: vec![],
                topups: vec![],
                storage_deposit: U128(deposit),
                created_at_ms: now,
            },
        );
        emit("capsule_created", json!({ "owner": owner, "agent_key": agent_key, "rules": rules }));
    }

    pub fn update_rules(&mut self, rules: Rules) {
        validate_rules(&rules);
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut();
        c.rules = rules.clone();
        emit("rules_updated", json!({ "owner": owner, "rules": rules }));
    }

    /// Point the capsule at a new agent key (or none). Rotating the key revokes the old agent.
    pub fn set_agent_key(&mut self, agent_key: Option<PublicKey>) {
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut();
        c.agent_key = agent_key.clone();
        emit("agent_key_set", json!({ "owner": owner, "agent_key": agent_key }));
    }

    /// The panic button: stops every agent payment until `unfreeze`.
    pub fn freeze(&mut self) {
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut();
        c.frozen = true;
        c.frozen_reason = Some("frozen by owner".into());
        emit("frozen", json!({ "owner": owner, "reason": "owner" }));
    }

    pub fn unfreeze(&mut self) {
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut();
        c.frozen = false;
        c.frozen_reason = None;
        c.strikes.clear();
        emit("unfrozen", json!({ "owner": owner }));
    }

    /// Move tokens out of the capsule back to the owner.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let owner = env::predecessor_account_id();
        let token = self.config.token.clone();
        let c = self.owner_capsule_mut();
        require!(amount.0 > 0 && amount.0 <= c.balance.0, "bad amount");
        c.balance = U128(c.balance.0 - amount.0);
        emit("withdrawn", json!({ "owner": owner, "amount": amount }));
        bump(INFLIGHT, &owner, true);
        token::ft_transfer(token, owner.clone(), amount, "tally withdraw")
            .then(Self::ext(env::current_account_id()).with_static_gas(token::GAS_CALLBACK).on_withdraw(owner, amount))
    }

    /// Close an empty capsule and refund its storage deposit.
    pub fn close_capsule(&mut self) -> Promise {
        let owner = env::predecessor_account_id();
        let c = self.owner_capsule_mut();
        require!(c.balance.0 == 0, "withdraw the balance first");
        let refund = c.storage_deposit.0;
        // a bounced payout or withdrawal refunds into the capsule, so it must still exist
        require!(counter(INFLIGHT, &owner) == 0, "a payout or withdrawal is still in flight");
        self.capsules.remove(&owner);
        emit("capsule_closed", json!({ "owner": owner }));
        Promise::new(owner).transfer(NearToken::from_yoctonear(refund))
    }
}

impl Tally {
    /// The caller's capsule, refusing calls signed by its agent key or relayed by another contract.
    pub(crate) fn owner_capsule_mut(&mut self) -> &mut Capsule {
        let owner = env::predecessor_account_id();
        require!(env::signer_account_id() == owner, "owner must sign directly");
        let signer = env::signer_account_pk();
        let c = self.capsules.get_mut(&owner).unwrap_or_else(|| env::panic_str("no capsule"));
        require!(c.agent_key.as_ref() != Some(&signer), "the agent key cannot do this");
        c
    }
}

pub(crate) fn validate_rules(r: &Rules) {
    require!(r.per_tx_cap.0 <= r.daily_cap.0, "per_tx_cap above daily_cap");
    require!(r.categories.len() <= 256, "too many categories");
    require!(r.categories.iter().all(|c| *c < 256), "category ids are 0..=255");
}
