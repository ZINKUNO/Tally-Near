//! The Guard: an on-chain counterparty check every payment runs before money moves.
//!
//! `block` refuses the payment. `warn` routes it to the owner (Second Look). Agents can call the
//! `assess` view before they even propose a purchase; the contract runs the same function inside
//! `pay`, so a skipped or lying preflight changes nothing.
use crate::events::emit;
use crate::*;
use near_sdk::serde_json::json;

impl Tally {
    pub(crate) fn verdict(&self, merchant_id: &AccountId, capsule: Option<&Capsule>, now: u64) -> Verdict {
        let mut block = vec![];
        let mut warn = vec![];
        let Some(m) = self.merchants.get(merchant_id) else {
            return Verdict { level: Level::Block, reasons: vec!["not a registered merchant".into()] };
        };
        if let Some(b) = self.blocklist.get(merchant_id) {
            block.push(format!("merchant is on the shared blocklist: {}", b.reason));
        }
        if let Some(b) = self.blocklist.get(&m.payout) {
            block.push(format!("payout account is on the shared blocklist: {}", b.reason));
        }
        if !m.active {
            block.push("merchant is inactive".into());
        }
        if m.bond.0 < self.config.min_bond.0 {
            block.push("merchant bond was slashed below the protocol minimum".into());
        }
        if now.saturating_sub(m.registered_at_ms) < NEW_MERCHANT_MS {
            warn.push("merchant registered less than 24 h ago".into());
        }
        if m.payout_changed_at_ms != m.registered_at_ms && now.saturating_sub(m.payout_changed_at_ms) < NEW_MERCHANT_MS {
            warn.push("payout account changed less than 24 h ago".into());
        }
        if m.key_rotated_at_ms != m.registered_at_ms && now.saturating_sub(m.key_rotated_at_ms) < NEW_KEY_MS {
            warn.push("menu signing key rotated less than 1 h ago".into());
        }
        if m.open_disputes > 0 {
            warn.push(format!("{} open dispute(s) against this merchant", m.open_disputes));
        }
        let reports = self.reports.get(merchant_id).map_or(0, |r| r.len());
        if reports >= REPORTS_TO_WARN {
            warn.push(format!("{reports} owners reported this merchant"));
        }
        if let Some(c) = capsule {
            if m.bond.0 < c.rules.min_merchant_bond.0 {
                warn.push("merchant bond is below your minimum".into());
            }
        }
        if !block.is_empty() {
            Verdict { level: Level::Block, reasons: block }
        } else if !warn.is_empty() {
            Verdict { level: Level::Warn, reasons: warn }
        } else {
            Verdict { level: Level::Allow, reasons: vec![] }
        }
    }
}

#[near]
impl Tally {
    /// Report a counterparty with an evidence hash (for example the sha256 of a screenshot or a
    /// transcript). Only capsule owners can report, once per account. Two reports make the Guard
    /// warn; the arbiter can promote an account to the blocklist.
    pub fn report(&mut self, account_id: AccountId, evidence_hash: String, note: String) {
        let reporter = env::predecessor_account_id();
        require!(self.capsules.contains_key(&reporter), "only capsule owners can report");
        require!(hex32(&evidence_hash).is_some(), "evidence_hash must be 32-byte hex");
        let mut list = self.reports.get(&account_id).cloned().unwrap_or_default();
        require!(!list.iter().any(|r| r.reporter == reporter), "already reported");
        let note: String = note.chars().take(MAX_TEXT).collect();
        list.push(Report { reporter: reporter.clone(), evidence_hash: evidence_hash.clone(), note: note.clone(), at_ms: now_ms() });
        self.reports.insert(account_id.clone(), list);
        emit("reported", json!({ "account_id": account_id, "reporter": reporter, "evidence_hash": evidence_hash, "note": note }));
    }

    /// Arbiter: add an account to the shared blocklist every capsule's Guard reads.
    pub fn block_account(&mut self, account_id: AccountId, reason: String, evidence_hash: Option<String>) {
        require!(env::predecessor_account_id() == self.config.arbiter, "arbiter only");
        self.add_block(account_id, reason, evidence_hash);
    }

    pub fn unblock_account(&mut self, account_id: AccountId) {
        require!(env::predecessor_account_id() == self.config.arbiter, "arbiter only");
        self.blocklist.remove(&account_id);
        emit("unblocked", json!({ "account_id": account_id }));
    }
}

impl Tally {
    pub(crate) fn add_block(&mut self, account_id: AccountId, reason: String, evidence_hash: Option<String>) {
        let reason: String = reason.chars().take(MAX_TEXT).collect();
        self.blocklist.insert(account_id.clone(), BlockEntry { reason: reason.clone(), evidence_hash: evidence_hash.clone(), at_ms: now_ms() });
        emit("blocked", json!({ "account_id": account_id, "reason": reason, "evidence_hash": evidence_hash }));
    }
}
