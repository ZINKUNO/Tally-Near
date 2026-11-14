//! Read-only methods. `preview_pay` and `assess` let an agent (or a judge) see exactly what the
//! contract will decide before anything is signed.
use crate::*;
use near_sdk::json_types::U128;

#[near(serializers = [json])]
pub struct Preview {
    /// `paid`, `second_look` or `rejected`: what an agent-signed `pay` would do right now.
    pub outcome: String,
    pub code: Option<Reject>,
    pub reason: Option<String>,
    pub reasons: Vec<String>,
    pub guard: Option<Verdict>,
}

#[near(serializers = [json])]
pub struct Stats {
    pub merchants: u32,
    pub capsules: u32,
    pub receipts: u32,
    pub pending: u32,
    pub blocked: u32,
}

#[near]
impl Tally {
    pub fn get_config(&self) -> &Config {
        &self.config
    }

    pub fn stats(&self) -> Stats {
        Stats {
            merchants: self.merchants.len(),
            capsules: self.capsules.len(),
            receipts: self.receipts.len(),
            pending: self.pending.len(),
            blocked: self.blocklist.len(),
        }
    }

    pub fn get_merchant(&self, merchant_id: AccountId) -> Option<&Merchant> {
        self.merchants.get(&merchant_id)
    }

    pub fn list_merchants(&self, from: Option<u32>, limit: Option<u32>) -> Vec<(&AccountId, &Merchant)> {
        self.merchants.iter().skip(from.unwrap_or(0) as usize).take(limit.unwrap_or(50) as usize).collect()
    }

    pub fn get_capsule(&self, owner: AccountId) -> Option<&Capsule> {
        self.capsules.get(&owner)
    }

    pub fn get_receipt(&self, receipt_id: u64) -> Option<&Receipt> {
        self.receipts.get(receipt_id as u32)
    }

    /// Newest first.
    pub fn get_receipts(&self, owner: AccountId, limit: Option<u32>) -> Vec<&Receipt> {
        let ids = self.receipts_by_owner.get(&owner).cloned().unwrap_or_default();
        ids.iter().rev().take(limit.unwrap_or(50) as usize).filter_map(|i| self.receipts.get(*i as u32)).collect()
    }

    pub fn get_pending(&self, owner: AccountId) -> Vec<&Pending> {
        self.pending.values().filter(|p| p.owner == owner).collect()
    }

    /// The Guard's verdict on a merchant, optionally against one owner's rules.
    pub fn assess(&self, merchant_id: AccountId, owner: Option<AccountId>) -> Verdict {
        let c = owner.and_then(|o| self.capsules.get(&o));
        self.verdict(&merchant_id, c, now_ms())
    }

    /// Dry-run an agent-signed `pay` for `owner`.
    pub fn preview_pay(&self, owner: AccountId, args: PayArgs) -> Preview {
        let Some(c) = self.capsules.get(&owner) else {
            return Preview { outcome: "rejected".into(), code: None, reason: Some("no capsule".into()), reasons: vec![], guard: None };
        };
        let now = now_ms();
        match self.check(&owner, c, &args, now, now) {
            Err((code, reason)) => Preview { outcome: "rejected".into(), code: Some(code), reason: Some(reason), reasons: vec![], guard: None },
            Ok(k) if !k.needs_owner.is_empty() => Preview { outcome: "second_look".into(), code: None, reason: None, reasons: k.needs_owner, guard: Some(k.guard) },
            Ok(k) => Preview { outcome: "paid".into(), code: None, reason: None, reasons: vec![], guard: Some(k.guard) },
        }
    }

    pub fn get_blocklist(&self) -> Vec<(&AccountId, &BlockEntry)> {
        self.blocklist.iter().collect()
    }

    pub fn get_reports(&self, account_id: AccountId) -> Vec<Report> {
        self.reports.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_dispute(&self, receipt_id: u64) -> Option<&Dispute> {
        self.disputes.get(&receipt_id)
    }

    /// Spending headroom left in the current 24 h cycle.
    pub fn remaining_today(&self, owner: AccountId) -> U128 {
        let Some(c) = self.capsules.get(&owner) else { return U128(0) };
        let spent = if now_ms().saturating_sub(c.cycle_start_ms) >= CYCLE_MS { 0 } else { c.spent_in_cycle.0 };
        U128(c.rules.daily_cap.0.saturating_sub(spent).min(c.balance.0))
    }
}
