//! Byte formats shared by the Tally contract, the TypeScript SDK and the test vectors.
//!
//! Every layout here is normative. The TypeScript SDK (`packages/sdk/src/menu.ts`) must produce
//! identical bytes; `fixtures/vectors.json` pins them and both sides test against it.
#![no_std]
extern crate alloc;

pub mod hash;
pub mod header;
pub mod menu;
pub mod merkle;

/// Domain tag at the start of every signed menu header.
pub const DOMAIN: [u8; 16] = *b"TALLY_NEAR_MENU1";
/// Length of the canonical signed header in bytes.
pub const HEADER_LEN: usize = 144;
pub const HEADER_VERSION: u8 = 1;
pub const HASH_ALG_SHA256: u8 = 0;
/// Leaf and internal-node prefixes keep a node from ever being accepted as a leaf.
pub const LEAF_PREFIX: u8 = 0x00;
pub const NODE_PREFIX: u8 = 0x01;
/// Proofs deeper than this are rejected to bound gas (65,536 items is plenty for a menu).
pub const MAX_PROOF_DEPTH: usize = 16;
