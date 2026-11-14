//! NEP-141 plumbing: funding by `ft_transfer_call`, payouts and withdrawals by `ft_transfer`,
//! and callbacks that roll state back when a transfer fails.
use crate::events::emit;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{ext_contract, Gas, PromiseError, PromiseOrValue, Promise};

pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[near(serializers = [json])]
struct FundMsg {
    owner: AccountId,
    note: Option<String>,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

pub(crate) fn ft_transfer(token: AccountId, to: AccountId, amount: U128, memo: &str) -> Promise {
    ext_ft::ext(token)
        .with_attached_deposit(NearToken::from_yoctonear(1))
        .with_static_gas(GAS_FT_TRANSFER)
        .ft_transfer(to, amount, Some(memo.to_string()))
}

#[near]
impl Tally {
    /// NEP-141 receiver. `msg` picks whose capsule the tokens fund:
    ///   ""                                   the sender's own capsule
    ///   `{"owner":"alice.near","note":"..."}` someone else's (a family top-up)
    /// Without a matching capsule, or from another token, the whole amount is returned.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.config.token {
            return PromiseOrValue::Value(amount);
        }
        let (owner, note) = if msg.trim().is_empty() {
            (sender_id.clone(), String::new())
        } else {
            match near_sdk::serde_json::from_str::<FundMsg>(&msg) {
                Ok(m) => (m.owner, m.note.unwrap_or_default()),
                Err(_) => return PromiseOrValue::Value(amount),
            }
        };
        let Some(c) = self.capsules.get_mut(&owner) else {
            return PromiseOrValue::Value(amount);
        };
        c.balance = U128(c.balance.0 + amount.0);
        let note: String = note.chars().take(64).collect();
        c.topups.push(Topup { from: sender_id.clone(), amount, note: note.clone(), at_ms: now_ms() });
        if c.topups.len() > MAX_ATTEMPT_LOG {
            c.topups.remove(0);
        }
        let balance = c.balance;
        emit("funded", json!({ "owner": owner, "from": sender_id, "amount": amount, "balance": balance, "note": note }));
        PromiseOrValue::Value(U128(0))
    }

    #[private]
    pub fn on_payout(&mut self, receipt_id: u64, #[callback_result] result: Result<(), PromiseError>) -> bool {
        let Some(r) = self.receipts.get_mut(receipt_id as u32) else { return false };
        if result.is_ok() {
            r.status = ReceiptStatus::Settled;
            let (owner, merchant_id, price) = (r.owner.clone(), r.merchant_id.clone(), r.price);
            if let Some(m) = self.merchants.get_mut(&merchant_id) {
                m.sales += 1;
            }
            emit("settled", json!({ "receipt_id": receipt_id, "owner": owner, "merchant_id": merchant_id, "price": price }));
            return true;
        }
        // The payout bounced (for example, the payout account isn't registered with the token):
        // give the money and the cap headroom back, and free the nullifier so a retry can work.
        r.status = ReceiptStatus::Refunded;
        let (owner, price, nullifier) = (r.owner.clone(), r.price.0, crate::pay::nullifier_of(r));
        self.nullifiers.remove(&nullifier);
        if let Some(c) = self.capsules.get_mut(&owner) {
            c.balance = U128(c.balance.0 + price);
            c.spent_in_cycle = U128(c.spent_in_cycle.0.saturating_sub(price));
            c.total_spent = U128(c.total_spent.0.saturating_sub(price));
        }
        emit("refunded", json!({ "receipt_id": receipt_id, "owner": owner, "price": U128(price) }));
        false
    }

    #[private]
    pub fn on_withdraw(&mut self, owner: AccountId, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            return true;
        }
        if let Some(c) = self.capsules.get_mut(&owner) {
            c.balance = U128(c.balance.0 + amount.0);
        }
        emit("withdraw_failed", json!({ "owner": owner, "amount": amount }));
        false
    }
}
