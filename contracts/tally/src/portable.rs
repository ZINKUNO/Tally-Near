//! Portable receipts with NEAR Chain Signatures.
//!
//! `sign_receipt` asks NEAR's MPC signer to sign a settled receipt with a secp256k1 key derived for this
//! contract (path `tally-receipts`). The signed payload is the EIP-191 hash of the receipt digest, so any
//! EVM chain (or anyone off-chain) can check with `ecrecover` that *this* Tally contract on NEAR settled
//! that purchase: a merchant's back office, a loyalty contract on another chain, an auditor.
//!
//! Signatures are stored under their own storage prefix, so adding this needed no state migration.
use crate::events::emit;
use crate::*;
use near_sdk::serde_json::{json, Value};
use near_sdk::{ext_contract, Gas, Promise, PromiseError};
use tally_menu::hash::sha256v;

pub const RECEIPT_PATH: &str = "tally-receipts";
const DOMAIN: &[u8] = b"TALLY_RECEIPT_V1";
const SIGS_PREFIX: &[u8] = b"psig";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PortableSig {
    pub receipt_id: u64,
    /// sha256 over the canonical receipt fields (see `receipt_digest`).
    pub digest: String,
    /// keccak256("\x19Ethereum Signed Message:\n32" || digest): what the MPC network signed.
    pub payload: String,
    /// Compressed secp256k1 point R (hex), scalar s (hex) and recovery id from the MPC network.
    pub big_r: String,
    pub s: String,
    pub recovery_id: u8,
    pub signer: AccountId,
    pub path: String,
}

#[ext_contract(ext_signer)]
#[allow(dead_code)]
trait MpcSigner {
    fn sign(&mut self, request: Value) -> Value;
}

/// The MPC signer contract for this network.
pub fn mpc_signer() -> AccountId {
    let me = env::current_account_id();
    if me.as_str().ends_with(".testnet") || me.as_str() == "testnet" {
        "v1.signer-prod.testnet".parse().unwrap()
    } else {
        "v1.signer".parse().unwrap()
    }
}

/// Canonical receipt bytes: domain, contract, receipt id, owner, merchant, payout, item, price, time, co-signed.
pub fn digest_of(contract: &AccountId, r: &Receipt) -> [u8; 32] {
    sha256v(&[
        DOMAIN,
        contract.as_bytes(),
        &[0],
        &r.id.to_le_bytes(),
        r.owner.as_bytes(),
        &[0],
        r.merchant_id.as_bytes(),
        &[0],
        r.payout.as_bytes(),
        &[0],
        r.item_id.as_bytes(),
        &r.price.0.to_le_bytes(),
        &r.at_ms.to_le_bytes(),
        &[u8::from(r.cosigned)],
    ])
}

/// EIP-191 personal-message hash, what `ecrecover` checks against on EVM chains.
pub fn eth_signed_hash(digest: &[u8; 32]) -> [u8; 32] {
    let mut m = b"\x19Ethereum Signed Message:\n32".to_vec();
    m.extend_from_slice(digest);
    env::keccak256_array(&m)
}

fn sigs() -> near_sdk::store::LookupMap<u64, PortableSig> {
    near_sdk::store::LookupMap::new(SIGS_PREFIX.to_vec())
}

#[near]
impl Tally {
    /// Have NEAR's MPC network sign a settled receipt with this contract's derived secp256k1 key.
    /// Attach the signer's fee (1 yoctoNEAR on testnet; any excess is refunded by the signer).
    #[payable]
    pub fn sign_receipt(&mut self, receipt_id: u64) -> Promise {
        let r = self.receipts.get(receipt_id as u32).unwrap_or_else(|| env::panic_str("no such receipt"));
        require!(
            matches!(r.status, ReceiptStatus::Settled | ReceiptStatus::DisputeRejected),
            "only settled receipts are signed"
        );
        require!(sigs().get(&receipt_id).is_none(), "already signed");
        let deposit = env::attached_deposit();
        require!(deposit.as_yoctonear() >= 1, "attach the signer fee (at least 1 yoctoNEAR)");
        let digest = digest_of(&env::current_account_id(), r);
        let payload = hex::encode(eth_signed_hash(&digest));
        let request = json!({ "path": RECEIPT_PATH, "payload_v2": { "Ecdsa": payload }, "domain_id": 0 });
        ext_signer::ext(mpc_signer())
            .with_attached_deposit(deposit)
            .with_static_gas(Gas::from_tgas(60))
            .sign(request)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(15)).on_receipt_signed(receipt_id, hex::encode(digest), payload))
    }

    #[private]
    pub fn on_receipt_signed(&mut self, receipt_id: u64, digest: String, payload: String, #[callback_result] sig: Result<Value, PromiseError>) -> Option<PortableSig> {
        let v = sig.ok()?;
        let big_r = v.get("big_r")?.get("affine_point")?.as_str()?.to_string();
        let s = v.get("s")?.get("scalar")?.as_str()?.to_string();
        let recovery_id = v.get("recovery_id")?.as_u64()? as u8;
        let p = PortableSig { receipt_id, digest, payload, big_r, s, recovery_id, signer: mpc_signer(), path: RECEIPT_PATH.into() };
        let mut map = sigs();
        map.insert(receipt_id, p.clone());
        map.flush();
        emit("receipt_signed", json!({ "receipt_id": receipt_id, "payload": p.payload, "signer": p.signer, "path": p.path }));
        Some(p)
    }

    /// The MPC signature for a receipt, if one was requested.
    pub fn get_receipt_signature(&self, receipt_id: u64) -> Option<PortableSig> {
        sigs().get(&receipt_id).cloned()
    }

    /// The digest a verifier should recompute for a receipt (hex).
    pub fn receipt_digest(&self, receipt_id: u64) -> Option<String> {
        self.receipts.get(receipt_id as u32).map(|r| hex::encode(digest_of(&env::current_account_id(), r)))
    }
}
