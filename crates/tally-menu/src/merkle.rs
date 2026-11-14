//! Sorted-pair, domain-separated Merkle tree over catalog leaves.
use crate::{hash::sha256v, MAX_PROOF_DEPTH, NODE_PREFIX};
use alloc::vec::Vec;

/// `SHA256(0x01 || min(a,b) || max(a,b))`: sorted so proofs need no direction bits.
pub fn node_hash(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    sha256v(&[&[NODE_PREFIX], x, y])
}

/// Full tree kept level by level so any leaf's proof can be produced.
/// An odd node at the end of a level is promoted unchanged.
pub struct MerkleTree {
    levels: Vec<Vec<[u8; 32]>>,
}

impl MerkleTree {
    /// Panics on an empty slice: a menu always has at least one item.
    pub fn new(leaves: Vec<[u8; 32]>) -> Self {
        assert!(!leaves.is_empty(), "empty menu");
        let mut levels = alloc::vec![leaves];
        while levels[levels.len() - 1].len() > 1 {
            let next = levels[levels.len() - 1]
                .chunks(2)
                .map(|p| if p.len() == 2 { node_hash(&p[0], &p[1]) } else { p[0] })
                .collect();
            levels.push(next);
        }
        Self { levels }
    }

    pub fn root(&self) -> [u8; 32] {
        self.levels[self.levels.len() - 1][0]
    }

    /// Sibling hashes from leaf to root; promoted levels contribute no sibling.
    pub fn proof(&self, mut index: usize) -> Vec<[u8; 32]> {
        let mut out = Vec::new();
        for level in &self.levels[..self.levels.len() - 1] {
            if let Some(sib) = level.get(index ^ 1) {
                out.push(*sib);
            }
            index /= 2;
        }
        out
    }
}

/// Fold `proof` onto `leaf` and compare with `root`.
pub fn verify_proof(leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    proof.len() <= MAX_PROOF_DEPTH && proof.iter().fold(leaf, |n, s| node_hash(&n, s)) == root
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaves(n: usize) -> Vec<[u8; 32]> {
        (0..n).map(|i| sha256v(&[&[i as u8]])).collect()
    }

    #[test]
    fn single_leaf_root_is_leaf() {
        let t = MerkleTree::new(leaves(1));
        assert_eq!(t.root(), leaves(1)[0]);
        assert!(t.proof(0).is_empty());
    }

    #[test]
    fn every_leaf_verifies_for_sizes_1_to_33() {
        for n in 1..=33 {
            let l = leaves(n);
            let t = MerkleTree::new(l.clone());
            for (i, leaf) in l.iter().enumerate() {
                assert!(verify_proof(*leaf, &t.proof(i), t.root()), "n={n} i={i}");
            }
        }
    }

    #[test]
    fn wrong_leaf_fails() {
        let l = leaves(5);
        let t = MerkleTree::new(l.clone());
        assert!(!verify_proof(l[1], &t.proof(0), t.root()));
    }

    #[test]
    fn proof_deeper_than_16_rejected() {
        assert!(!verify_proof([0; 32], &alloc::vec![[0u8; 32]; 17], [0; 32]));
    }
}
