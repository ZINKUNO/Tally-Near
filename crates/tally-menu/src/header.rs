//! The 144-byte menu header a merchant signs with its Ed25519 menu key.
//!
//! ```text
//! 0..16    DOMAIN "TALLY_NEAR_MENU1"
//! 16..48   sha256(contract account id)   binds the signature to one Tally deployment
//! 48..80   sha256(merchant account id)   binds it to one registered merchant
//! 80..112  Merkle root of the catalog
//! 112..120 issued_at_ms  (u64 LE)
//! 120..128 expires_at_ms (u64 LE)
//! 128..136 menu_nonce    (u64 LE)
//! 136..140 item_count    (u32 LE)
//! 140      hash algorithm (0 = SHA-256)
//! 141      header version (1)
//! 142..144 zero padding
//! ```
//! The contract never accepts a header from the caller: it rebuilds these bytes from typed
//! arguments and its own account id, then verifies the signature over them.
use crate::{hash::sha256v, DOMAIN, HASH_ALG_SHA256, HEADER_LEN, HEADER_VERSION};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeaderFields<'a> {
    pub contract_id: &'a str,
    pub merchant_id: &'a str,
    pub menu_root: [u8; 32],
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub menu_nonce: u64,
    pub item_count: u32,
}

pub fn build_header(f: &HeaderFields) -> [u8; HEADER_LEN] {
    let mut h = [0u8; HEADER_LEN];
    h[0..16].copy_from_slice(&DOMAIN);
    h[16..48].copy_from_slice(&sha256v(&[f.contract_id.as_bytes()]));
    h[48..80].copy_from_slice(&sha256v(&[f.merchant_id.as_bytes()]));
    h[80..112].copy_from_slice(&f.menu_root);
    h[112..120].copy_from_slice(&f.issued_at_ms.to_le_bytes());
    h[120..128].copy_from_slice(&f.expires_at_ms.to_le_bytes());
    h[128..136].copy_from_slice(&f.menu_nonce.to_le_bytes());
    h[136..140].copy_from_slice(&f.item_count.to_le_bytes());
    h[140] = HASH_ALG_SHA256;
    h[141] = HEADER_VERSION;
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> HeaderFields<'static> {
        HeaderFields {
            contract_id: "tally.testnet",
            merchant_id: "cafe.testnet",
            menu_root: [3; 32],
            issued_at_ms: 0x0102030405060708,
            expires_at_ms: 9,
            menu_nonce: 42,
            item_count: 8,
        }
    }

    #[test]
    fn layout_is_exact() {
        let h = build_header(&sample());
        assert_eq!(&h[0..16], b"TALLY_NEAR_MENU1");
        assert_eq!(&h[16..48], &sha256v(&[b"tally.testnet"]));
        assert_eq!(&h[48..80], &sha256v(&[b"cafe.testnet"]));
        assert_eq!(&h[80..112], &[3; 32]);
        assert_eq!(&h[112..120], &0x0102030405060708u64.to_le_bytes());
        assert_eq!(&h[120..128], &9u64.to_le_bytes());
        assert_eq!(&h[128..136], &42u64.to_le_bytes());
        assert_eq!(&h[136..140], &8u32.to_le_bytes());
        assert_eq!((h[140], h[141], h[142], h[143]), (0, 1, 0, 0));
    }

    #[test]
    fn every_field_is_bound() {
        let base = build_header(&sample());
        let mut s = sample();
        s.menu_nonce = 43;
        assert_ne!(base, build_header(&s));
        let mut s = sample();
        s.contract_id = "evil.testnet";
        assert_ne!(base, build_header(&s));
        let mut s = sample();
        s.merchant_id = "cafe2.testnet";
        assert_ne!(base, build_header(&s));
        let mut s = sample();
        s.expires_at_ms = 10;
        assert_ne!(base, build_header(&s));
    }
}
