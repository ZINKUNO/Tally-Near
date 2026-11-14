//! Tally: an AI agent may pay only for an item a merchant signed, at the signed price, to the
//! registered merchant, inside the owner's rules. Anything else is refused by this contract.
//!
//! The agent never holds a key that can move money freely. It signs with a function-call access
//! key on the owner's own account, scoped to this contract's `pay` method. The contract tells that
//! key apart from the owner's other keys with `env::signer_account_pk()`, so "the agent did it" and
//! "the owner did it" are different on-chain facts.
use near_sdk::store::{IterableMap, LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PublicKey};

pub mod events;
pub mod types;

mod capsule;
mod dispute;
mod guard;
mod merchant;
mod pay;
mod token;
mod views;


pub use types::*;

/// Menus valid at most this long may be paid without the owner.
pub const MAX_AUTONOMOUS_WINDOW_MS: u64 = 10 * 60 * 1000;
/// Extended menus (needs `allow_extended` and the owner's approval) are capped at 24 h.
pub const MAX_EXTENDED_WINDOW_MS: u64 = 24 * 60 * 60 * 1000;
/// Rolling spending cycle for `daily_cap`.
pub const CYCLE_MS: u64 = 24 * 60 * 60 * 1000;
/// Tripwire counts rejected agent attempts in this window.
pub const STRIKE_WINDOW_MS: u64 = 60 * 60 * 1000;
/// A Second Look request expires after this long.
pub const PENDING_TTL_MS: u64 = 30 * 60 * 1000;
/// A merchant younger than this, or with a payout changed this recently, draws a Guard warning.
pub const NEW_MERCHANT_MS: u64 = 24 * 60 * 60 * 1000;
/// A signing key rotated this recently draws a Guard warning.
pub const NEW_KEY_MS: u64 = 60 * 60 * 1000;
/// Distinct owner reports on an account that draw a Guard warning.
pub const REPORTS_TO_WARN: usize = 2;
/// Disputes can be opened this long after a purchase.
pub const DISPUTE_WINDOW_MS: u64 = 7 * 24 * 60 * 60 * 1000;
pub const MAX_ATTEMPT_LOG: usize = 20;
pub const MAX_TEXT: usize = 160;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Merchants,
    Capsules,
    Receipts,
    ReceiptsByOwner,
    Nullifiers,
    Pending,
    Disputes,
    FraudRoots,
    Blocklist,
    Reports,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Tally {
    config: Config,
    merchants: IterableMap<AccountId, Merchant>,
    capsules: IterableMap<AccountId, Capsule>,
    receipts: Vector<Receipt>,
    receipts_by_owner: LookupMap<AccountId, Vec<u64>>,
    nullifiers: LookupSet<[u8; 32]>,
    pending: IterableMap<u64, Pending>,
    next_pending: u64,
    disputes: IterableMap<u64, Dispute>,
    fraud_roots: LookupSet<[u8; 32]>,
    blocklist: IterableMap<AccountId, BlockEntry>,
    reports: IterableMap<AccountId, Vec<Report>>,
}

#[near]
impl Tally {
    #[init]
    pub fn new(arbiter: AccountId, token: AccountId) -> Self {
        Self {
            config: Config {
                admin: env::predecessor_account_id(),
                arbiter,
                token,
                min_bond: NearToken::from_millinear(500).as_yoctonear().into(),
                slash_bps: 5_000,
                bond_unlock_delay_ms: 60 * 60 * 1000,
                capsule_storage: NearToken::from_millinear(100).as_yoctonear().into(),
            },
            merchants: IterableMap::new(Key::Merchants),
            capsules: IterableMap::new(Key::Capsules),
            receipts: Vector::new(Key::Receipts),
            receipts_by_owner: LookupMap::new(Key::ReceiptsByOwner),
            nullifiers: LookupSet::new(Key::Nullifiers),
            pending: IterableMap::new(Key::Pending),
            next_pending: 0,
            disputes: IterableMap::new(Key::Disputes),
            fraud_roots: LookupSet::new(Key::FraudRoots),
            blocklist: IterableMap::new(Key::Blocklist),
            reports: IterableMap::new(Key::Reports),
        }
    }

    /// Admin: change the arbiter (for example to a Sputnik DAO) or the economic parameters.
    pub fn set_config(
        &mut self,
        arbiter: Option<AccountId>,
        min_bond: Option<near_sdk::json_types::U128>,
        slash_bps: Option<u16>,
        bond_unlock_delay_ms: Option<u64>,
    ) {
        require!(env::predecessor_account_id() == self.config.admin, "admin only");
        if let Some(a) = arbiter {
            self.config.arbiter = a;
        }
        if let Some(b) = min_bond {
            self.config.min_bond = b;
        }
        if let Some(s) = slash_bps {
            require!(s <= 10_000, "slash_bps over 10000");
            self.config.slash_bps = s;
        }
        if let Some(d) = bond_unlock_delay_ms {
            self.config.bond_unlock_delay_ms = d;
        }
    }
}

// ---- helpers shared by the modules ----

pub(crate) fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

pub(crate) fn hex32(s: &str) -> Option<[u8; 32]> {
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

pub(crate) fn hex16(s: &str) -> Option<[u8; 16]> {
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

pub(crate) fn hex64(s: &str) -> Option<[u8; 64]> {
    let v = hex::decode(s).ok()?;
    v.try_into().ok()
}

/// Raw 32 bytes of an ed25519 `PublicKey`, or `None` for other curves.
pub(crate) fn ed25519_bytes(pk: &PublicKey) -> Option<[u8; 32]> {
    let b = pk.as_bytes();
    if b.len() == 33 && b[0] == 0 {
        b[1..].try_into().ok()
    } else {
        None
    }
}

pub(crate) fn short(s: Option<String>) -> Option<String> {
    s.map(|t| t.chars().take(MAX_TEXT).collect())
}
