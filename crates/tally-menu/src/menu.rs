//! Catalog items, leaf hashing and the category-floor rule.
use crate::{hash::sha256v, LEAF_PREFIX};

/// One catalog entry as committed in the Merkle tree. Display text (name, description) never
/// reaches a leaf, so merchant prose can't smuggle instructions to an agent through the proof.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Item {
    pub id: [u8; 16],
    pub category: u16,
    /// Price in the payment token's smallest unit (tUSDC: 6 decimals).
    pub price: u128,
    /// Merchant-certified cheapest price in `category` on this menu.
    pub floor: u128,
}

/// `SHA256(0x00 || id || category_le16 || price_le128 || floor_le128)`, 51-byte preimage.
pub fn leaf_hash(i: &Item) -> [u8; 32] {
    sha256v(&[
        &[LEAF_PREFIX],
        &i.id,
        &i.category.to_le_bytes(),
        &i.price.to_le_bytes(),
        &i.floor.to_le_bytes(),
    ])
}

/// Set every item's floor to the minimum price among items of its category.
pub fn compute_floors(items: &mut [Item]) {
    for idx in 0..items.len() {
        let cat = items[idx].category;
        items[idx].floor = items
            .iter()
            .filter(|o| o.category == cat)
            .map(|o| o.price)
            .min()
            .unwrap_or(items[idx].price);
    }
}

/// A signed menu contradicts itself when an item is cheaper than the floor another item in the
/// same category certifies. The contract slashes the merchant's bond for exactly this.
pub fn is_floor_contradiction(cheap: &Item, claimed: &Item) -> bool {
    cheap.category == claimed.category && cheap.price < claimed.floor
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    fn it(n: u8, cat: u16, price: u128) -> Item {
        Item { id: [n; 16], category: cat, price, floor: 0 }
    }

    #[test]
    fn leaf_preimage_layout() {
        let i = Item { id: [9; 16], category: 0x0103, price: 4_500_000, floor: 3_500_000 };
        let mut pre = alloc::vec![0x00u8];
        pre.extend_from_slice(&[9; 16]);
        pre.extend_from_slice(&0x0103u16.to_le_bytes());
        pre.extend_from_slice(&4_500_000u128.to_le_bytes());
        pre.extend_from_slice(&3_500_000u128.to_le_bytes());
        assert_eq!(pre.len(), 51);
        assert_eq!(leaf_hash(&i), sha256v(&[&pre]));
    }

    #[test]
    fn price_change_changes_leaf() {
        let a = Item { id: [1; 16], category: 3, price: 450, floor: 450 };
        assert_ne!(leaf_hash(&a), leaf_hash(&Item { price: 990, ..a }));
    }

    #[test]
    fn floors_are_min_per_category() {
        let mut v = alloc::vec![it(1, 3, 590), it(2, 3, 450), it(3, 0, 300), it(4, 3, 520)];
        compute_floors(&mut v);
        assert_eq!(v.iter().map(|i| i.floor).collect::<Vec<_>>(), [450, 450, 300, 450]);
        assert!(!v.iter().any(|a| v.iter().any(|b| is_floor_contradiction(a, b))));
    }

    #[test]
    fn contradiction_detected() {
        let mut v = alloc::vec![it(1, 3, 590), it(2, 3, 450)];
        compute_floors(&mut v);
        v[0].floor = 590; // merchant claims the large latte is the cheapest coffee
        assert!(is_floor_contradiction(&v[1], &v[0]));
        assert!(!is_floor_contradiction(&v[0], &v[1]));
    }
}
