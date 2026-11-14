//! Writes `fixtures/vectors.json`: header, leaves, root and proofs for a fixed menu.
//! The TypeScript SDK test compares its own output against this file byte for byte.
//! Run: cargo run -p tally-menu --example vectors > fixtures/vectors.json
use tally_menu::header::{build_header, HeaderFields};
use tally_menu::menu::{compute_floors, leaf_hash, Item};
use tally_menu::merkle::MerkleTree;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let mut items = vec![
        Item { id: [1; 16], category: 1, price: 4_500_000, floor: 0 },
        Item { id: [2; 16], category: 1, price: 5_900_000, floor: 0 },
        Item { id: [3; 16], category: 2, price: 3_000_000, floor: 0 },
        Item { id: [4; 16], category: 3, price: 12_000_000, floor: 0 },
        Item { id: [5; 16], category: 2, price: 2_750_000, floor: 0 },
    ];
    compute_floors(&mut items);
    let leaves: Vec<[u8; 32]> = items.iter().map(leaf_hash).collect();
    let tree = MerkleTree::new(leaves.clone());
    let header = build_header(&HeaderFields {
        contract_id: "tally.testnet",
        merchant_id: "cafe.testnet",
        menu_root: tree.root(),
        issued_at_ms: 1_800_000_000_000,
        expires_at_ms: 1_800_000_300_000,
        menu_nonce: 7,
        item_count: items.len() as u32,
    });
    let items_json: Vec<String> = items
        .iter()
        .map(|i| format!(r#"{{"id":"{}","category":{},"price":"{}","floor":"{}"}}"#, hex(&i.id), i.category, i.price, i.floor))
        .collect();
    let leaves_json: Vec<String> = leaves.iter().map(|l| format!("\"{}\"", hex(l))).collect();
    let proofs_json: Vec<String> = (0..items.len())
        .map(|i| format!("[{}]", tree.proof(i).iter().map(|p| format!("\"{}\"", hex(p))).collect::<Vec<_>>().join(",")))
        .collect();
    println!(
        r#"{{"contract_id":"tally.testnet","merchant_id":"cafe.testnet","issued_at_ms":1800000000000,"expires_at_ms":1800000300000,"menu_nonce":7,"items":[{}],"leaves":[{}],"root":"{}","proofs":[{}],"header":"{}"}}"#,
        items_json.join(","),
        leaves_json.join(","),
        hex(&tree.root()),
        proofs_json.join(","),
        hex(&header)
    );
}
