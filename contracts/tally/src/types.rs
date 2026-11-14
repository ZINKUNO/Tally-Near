//! Stored records and the JSON shapes the contract accepts and returns.
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, PublicKey};

/// A merchant's registry entry. The menu signing key can rotate; every key ever used stays in
/// `key_history`, so a signature made with a rotated-out key is still attributable and slashable.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Merchant {
    pub name: String,
    pub signing_key: PublicKey,
    pub key_history: Vec<PublicKey>,
    pub payout: AccountId,
    /// Refundable NEAR bond in yoctoNEAR. Slashed for proven fraud or upheld disputes.
    pub bond: U128,
    pub slashed_total: U128,
    pub registered_at_ms: u64,
    pub payout_changed_at_ms: u64,
    pub key_rotated_at_ms: u64,
    pub bond_unlock_at_ms: Option<u64>,
    pub open_disputes: u32,
    pub sales: u64,
    pub active: bool,
}

/// The owner's rules. Only the owner's account (never the agent key) can change them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Rules {
    /// Largest single purchase, in token units.
    pub per_tx_cap: U128,
    /// Rolling 24-hour spending cap, in token units.
    pub daily_cap: U128,
    /// Category ids (0..=255) the agent may buy from.
    pub categories: Vec<u16>,
    /// Merchants bonded below this (yoctoNEAR) need the owner's approval.
    pub min_merchant_bond: U128,
    /// After this time the capsule refuses all agent payments.
    pub expiry_ms: u64,
    /// Allow menus valid longer than 10 minutes (up to 24 h). Such purchases always need approval.
    pub allow_extended: bool,
    /// Rejected agent attempts within one hour that freeze the capsule. 0 disables the tripwire.
    pub tripwire: u8,
}

/// One rejected agent attempt, kept so the owner sees what the agent tried.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Attempt {
    pub at_ms: u64,
    pub merchant_id: AccountId,
    pub price: U128,
    pub code: Reject,
    pub reason: String,
}

/// A user's spending capsule: rules, a token balance the agent may spend from, and the one
/// function-call key that counts as "the agent".
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Capsule {
    pub agent_key: Option<PublicKey>,
    pub rules: Rules,
    pub balance: U128,
    pub spent_in_cycle: U128,
    pub cycle_start_ms: u64,
    pub total_spent: U128,
    pub frozen: bool,
    pub frozen_reason: Option<String>,
    /// Timestamps of recent rejected agent attempts (tripwire window).
    pub strikes: Vec<u64>,
    /// Last 20 rejected attempts.
    pub attempts: Vec<Attempt>,
    pub storage_deposit: U128,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReceiptStatus {
    /// Funds left the capsule; the token transfer is in flight.
    Sending,
    Settled,
    /// The token transfer failed and the capsule was refunded.
    Refunded,
    Disputed,
    DisputeUpheld,
    DisputeRejected,
}

/// One purchase. `(owner, merchant, menu_nonce, item_id)` is its duplicate-settlement nullifier.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Receipt {
    pub id: u64,
    pub owner: AccountId,
    pub merchant_id: AccountId,
    pub payout: AccountId,
    pub menu_root: String,
    pub menu_nonce: u64,
    pub item_id: String,
    pub category: u16,
    pub price: U128,
    pub floor: U128,
    pub at_ms: u64,
    /// True when the owner approved it (Second Look) or paid it directly.
    pub cosigned: bool,
    pub guard: Verdict,
    pub memo: Option<String>,
    /// Digest of the inference attestation the agent ran under, if it reported one.
    pub attestation: Option<String>,
    pub status: ReceiptStatus,
    pub evidence_hash: Option<String>,
}

/// A purchase parked for the owner's decision ("Second Look").
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub id: u64,
    pub owner: AccountId,
    pub args: PayArgs,
    pub reasons: Vec<String>,
    pub guard: Verdict,
    pub proposed_at_ms: u64,
    pub expires_at_ms: u64,
}

/// Everything needed to rebuild the merchant-signed header and the chosen catalog leaf.
/// 32-byte values, the 16-byte item id and the 64-byte signature are lowercase hex.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PayArgs {
    pub merchant_id: AccountId,
    pub menu_root: String,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub menu_nonce: u64,
    pub item_count: u32,
    pub item_id: String,
    pub category: u16,
    pub price: U128,
    pub floor: U128,
    pub proof: Vec<String>,
    pub signature: String,
    /// The agent's one-line reason (shown to the owner, never trusted).
    pub memo: Option<String>,
    pub attestation: Option<String>,
}

/// A catalog leaf plus its Merkle proof, used by `prove_floor_fraud`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct LeafProof {
    pub item_id: String,
    pub category: u16,
    pub price: U128,
    pub floor: U128,
    pub proof: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Allow,
    Warn,
    Block,
}

/// The Guard's counterparty verdict on a merchant, with the reasons behind it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub level: Level,
    pub reasons: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Reject {
    Frozen,
    Expired,
    UnknownMerchant,
    MerchantInactive,
    GuardBlock,
    BadSignature,
    Stale,
    WindowTooLong,
    NotOnMenu,
    Category,
    OverPerTx,
    OverDaily,
    InsufficientBalance,
    Duplicate,
    BadArgs,
}

/// What `pay` did. Agent payments never panic on a rule violation: the attempt is recorded so
/// the tripwire can count it, and the agent gets the reason back.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PayOutcome {
    Paid { receipt_id: u64 },
    SecondLook { pending_id: u64, reasons: Vec<String> },
    Rejected { code: Reject, reason: String, frozen: bool },
}

/// Shared blocklist entry, written by the arbiter or automatically by a proven fraud.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct BlockEntry {
    pub reason: String,
    pub evidence_hash: Option<String>,
    pub at_ms: u64,
}

/// A counterparty report from a capsule owner, with an evidence hash.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Report {
    pub reporter: AccountId,
    pub evidence_hash: String,
    pub note: String,
    pub at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DisputeStatus {
    Open,
    Upheld,
    Rejected,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub receipt_id: u64,
    pub claimant: AccountId,
    pub merchant_id: AccountId,
    pub evidence_hash: String,
    pub status: DisputeStatus,
    pub slashed: U128,
    pub opened_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub admin: AccountId,
    pub arbiter: AccountId,
    /// The NEP-141 stablecoin capsules hold and merchants are paid in.
    pub token: AccountId,
    /// Minimum merchant bond in yoctoNEAR.
    pub min_bond: U128,
    /// Share of the bond a proven floor fraud slashes to the reporter (basis points).
    pub slash_bps: u16,
    /// Wait between asking to unlock a bond and withdrawing it.
    pub bond_unlock_delay_ms: u64,
    /// NEAR a new capsule locks for storage, refunded on close.
    pub capsule_storage: U128,
    /// The Guard warns about merchants younger than this, or whose payout changed this recently.
    pub new_merchant_ms: u64,
    /// The Guard warns about a menu key rotated this recently.
    pub new_key_ms: u64,
}
