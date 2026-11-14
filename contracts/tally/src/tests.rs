//! Unit tests: every invariant in `pay.rs`, the Guard, Second Look, tripwire, refunds, disputes
//! and floor fraud, with real Ed25519 signatures over the real header bytes.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseError};
use tally_menu::header::{build_header, HeaderFields};
use tally_menu::menu::{compute_floors, leaf_hash, Item};
use tally_menu::merkle::MerkleTree;

const T0: u64 = 1_800_000_000_000; // ms
const DAY: u64 = 24 * 60 * 60 * 1000;
const USDC: u128 = 1_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn pk(sk: &SigningKey) -> PublicKey {
    let mut b = vec![0u8];
    b.extend_from_slice(sk.verifying_key().as_bytes());
    PublicKey::try_from(b).unwrap()
}
fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

/// Who signs the next call: `account` with key `signer_key`, at time `ms`, attaching `deposit`.
fn ctx(account: &str, signer_key: &PublicKey, ms: u64, deposit: NearToken) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("tally.testnet"))
        .predecessor_account_id(acc(account))
        .signer_account_id(acc(account))
        .signer_account_pk(signer_key.clone())
        .block_timestamp(ms * 1_000_000)
        .attached_deposit(deposit);
    testing_env!(b.build());
}

struct Menu {
    items: Vec<Item>,
    tree: MerkleTree,
    issued: u64,
    expires: u64,
    nonce: u64,
    merchant: String,
    contract: String,
}

impl Menu {
    fn new(merchant: &str, prices: &[(u16, u128)], issued: u64, window: u64, nonce: u64) -> Self {
        let mut items: Vec<Item> = prices
            .iter()
            .enumerate()
            .map(|(i, (cat, p))| Item { id: [i as u8 + 1; 16], category: *cat, price: *p, floor: 0 })
            .collect();
        compute_floors(&mut items);
        let tree = MerkleTree::new(items.iter().map(leaf_hash).collect());
        Menu { items, tree, issued, expires: issued + window, nonce, merchant: merchant.into(), contract: "tally.testnet".into() }
    }
    fn header(&self) -> [u8; 144] {
        build_header(&HeaderFields {
            contract_id: &self.contract,
            merchant_id: &self.merchant,
            menu_root: self.tree.root(),
            issued_at_ms: self.issued,
            expires_at_ms: self.expires,
            menu_nonce: self.nonce,
            item_count: self.items.len() as u32,
        })
    }
    fn args(&self, sk: &SigningKey, i: usize) -> PayArgs {
        let it = self.items[i];
        PayArgs {
            merchant_id: acc(&self.merchant),
            menu_root: hex::encode(self.tree.root()),
            issued_at_ms: self.issued,
            expires_at_ms: self.expires,
            menu_nonce: self.nonce,
            item_count: self.items.len() as u32,
            item_id: hex::encode(it.id),
            category: it.category,
            price: U128(it.price),
            floor: U128(it.floor),
            proof: self.tree.proof(i).iter().map(hex::encode).collect(),
            signature: hex::encode(sk.sign(&self.header()).to_bytes()),
            memo: Some("cheapest coffee".into()),
            attestation: None,
        }
    }
    fn leaf(&self, i: usize) -> LeafProof {
        let it = self.items[i];
        LeafProof {
            item_id: hex::encode(it.id),
            category: it.category,
            price: U128(it.price),
            floor: U128(it.floor),
            proof: self.tree.proof(i).iter().map(hex::encode).collect(),
        }
    }
}

fn rules() -> Rules {
    Rules {
        per_tx_cap: U128(10 * USDC),
        daily_cap: U128(25 * USDC),
        categories: vec![1, 2],
        min_merchant_bond: U128(0),
        expiry_ms: T0 + 30 * DAY,
        allow_extended: false,
        tripwire: 3,
    }
}

/// Owner `alice` (full key 10, agent key 20) with 100 tUSDC; merchant `cafe` (menu key 30)
/// registered two days ago so the Guard sees an established merchant.
struct World {
    c: Tally,
    owner_pk: PublicKey,
    agent_pk: PublicKey,
    menu_sk: SigningKey,
}

fn world() -> World {
    let owner_pk = pk(&key(10));
    let agent_pk = pk(&key(20));
    let menu_sk = key(30);
    let cafe_pk = pk(&key(31));
    ctx("admin.testnet", &cafe_pk, T0 - 3 * DAY, NearToken::from_near(0));
    let mut c = Tally::new(acc("arbiter.testnet"), acc("tusdc.testnet"));
    ctx("cafe.testnet", &cafe_pk, T0 - 2 * DAY, NearToken::from_near(1));
    c.register_merchant("Corner Cafe".into(), pk(&menu_sk), acc("cafe-payout.testnet"));
    ctx("alice.testnet", &owner_pk, T0 - DAY, NearToken::from_millinear(100));
    c.create_capsule(rules(), Some(agent_pk.clone()));
    ctx("tusdc.testnet", &owner_pk, T0 - DAY, NearToken::from_near(0));
    let _ = c.ft_on_transfer(acc("alice.testnet"), U128(100 * USDC), String::new());
    World { c, owner_pk, agent_pk, menu_sk }
}

// coffee 4.50 (floor), coffee 5.90, pastry 3.00, merch 12.00 (category 3 not allowed)
fn cafe_menu(issued: u64) -> Menu {
    Menu::new("cafe.testnet", &[(1, 4_500_000), (1, 5_900_000), (2, 3_000_000), (3, 12_000_000)], issued, 5 * 60 * 1000, 7)
}

fn agent(w: &World, ms: u64) {
    ctx("alice.testnet", &w.agent_pk, ms, NearToken::from_near(0));
}
fn owner(w: &World, ms: u64) {
    ctx("alice.testnet", &w.owner_pk, ms, NearToken::from_near(0));
}
fn rejected(o: PayOutcome) -> (Reject, bool) {
    match o {
        PayOutcome::Rejected { code, frozen, .. } => (code, frozen),
        other => panic!("expected rejected, got {other:?}"),
    }
}

#[test]
fn agent_pays_cheapest_signed_item_autonomously() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let out = w.c.pay(m.args(&w.menu_sk, 0));
    assert!(matches!(out, PayOutcome::Paid { receipt_id: 0 }), "{out:?}");
    let cap = w.c.get_capsule(acc("alice.testnet")).unwrap();
    assert_eq!(cap.balance.0, 100 * USDC - 4_500_000);
    let r = w.c.get_receipt(0).unwrap();
    assert_eq!(r.payout, acc("cafe-payout.testnet"));
    assert_eq!(r.status, ReceiptStatus::Sending);
    assert!(!r.cosigned);
    w.c.on_payout(0, Ok(()));
    assert_eq!(w.c.get_receipt(0).unwrap().status, ReceiptStatus::Settled);
    assert_eq!(w.c.get_merchant(acc("cafe.testnet")).unwrap().sales, 1);
}

#[test]
fn tampered_price_is_not_on_menu() {
    let mut w = world();
    let m = cafe_menu(T0);
    let mut a = m.args(&w.menu_sk, 0);
    a.price = U128(1); // agent (or an injected prompt) claims a lower price
    a.floor = U128(1);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(a)).0, Reject::NotOnMenu);
}

#[test]
fn menu_signed_by_another_key_is_refused() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&key(99), 0))).0, Reject::BadSignature);
}

#[test]
fn signature_for_another_deployment_does_not_replay() {
    let mut w = world();
    let mut m = cafe_menu(T0);
    m.contract = "other-tally.testnet".into();
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::BadSignature);
}

#[test]
fn signature_for_another_merchant_does_not_transfer() {
    let mut w = world();
    let mut m = cafe_menu(T0);
    m.merchant = "evil.testnet".into(); // signed for evil, presented as cafe
    let mut a = m.args(&w.menu_sk, 0);
    a.merchant_id = acc("cafe.testnet");
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(a)).0, Reject::BadSignature);
}

#[test]
fn expired_menu_is_stale() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 10 * 60 * 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::Stale);
}

#[test]
fn long_menu_window_needs_opt_in_and_owner() {
    let mut w = world();
    let m = Menu::new("cafe.testnet", &[(1, 4_500_000)], T0, 2 * 60 * 60 * 1000, 8);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::WindowTooLong);
    owner(&w, T0 + 1000);
    let mut r = rules();
    r.allow_extended = true;
    w.c.update_rules(r);
    agent(&w, T0 + 2000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::SecondLook { .. }));
}

#[test]
fn category_and_caps_are_enforced() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 3))).0, Reject::Category);
    owner(&w, T0 + 1000);
    let mut r = rules();
    r.categories = vec![1, 2, 3];
    w.c.update_rules(r);
    agent(&w, T0 + 2000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 3))).0, Reject::OverPerTx);
}

#[test]
fn daily_cap_rolls_over_after_24h() {
    let mut w = world();
    owner(&w, T0);
    let mut r = rules();
    r.daily_cap = U128(8 * USDC);
    r.per_tx_cap = U128(8 * USDC);
    r.tripwire = 0;
    w.c.update_rules(r);
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
    let m2 = Menu::new("cafe.testnet", &[(1, 4_500_000)], T0 + 2000, 300_000, 9);
    agent(&w, T0 + 3000);
    assert_eq!(rejected(w.c.pay(m2.args(&w.menu_sk, 0))).0, Reject::OverDaily);
    let m3 = Menu::new("cafe.testnet", &[(1, 4_500_000)], T0 + DAY + 1000, 300_000, 10);
    agent(&w, T0 + DAY + 2000);
    assert!(matches!(w.c.pay(m3.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
}

#[test]
fn same_menu_item_cannot_be_paid_twice() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
    agent(&w, T0 + 2000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::Duplicate);
}

#[test]
fn pricier_pick_waits_for_owner_then_pays_on_approve() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { pending_id, reasons } = w.c.pay(m.args(&w.menu_sk, 1)) else { panic!() };
    assert!(reasons[0].contains("not the cheapest"));
    assert_eq!(w.c.get_capsule(acc("alice.testnet")).unwrap().balance.0, 100 * USDC);
    // well after the 5-minute menu window: approval checks freshness at proposal time
    owner(&w, T0 + 6 * 60 * 1000);
    assert!(matches!(w.c.approve(pending_id), PayOutcome::Paid { .. }));
    let r = w.c.get_receipt(0).unwrap();
    assert!(r.cosigned);
    assert_eq!(r.price.0, 5_900_000);
}

#[test]
#[should_panic(expected = "the agent key cannot do this")]
fn agent_key_cannot_approve_its_own_second_look() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { pending_id, .. } = w.c.pay(m.args(&w.menu_sk, 1)) else { panic!() };
    agent(&w, T0 + 2000);
    w.c.approve(pending_id);
}

#[test]
#[should_panic(expected = "the agent key cannot do this")]
fn agent_key_cannot_loosen_rules() {
    let mut w = world();
    agent(&w, T0);
    let mut r = rules();
    r.per_tx_cap = U128(1_000 * USDC);
    r.daily_cap = U128(1_000 * USDC);
    w.c.update_rules(r);
}

#[test]
#[should_panic(expected = "the agent key cannot do this")]
fn agent_key_cannot_unfreeze() {
    let mut w = world();
    owner(&w, T0);
    w.c.freeze();
    agent(&w, T0 + 1);
    w.c.unfreeze();
}

#[test]
#[should_panic(expected = "Second Look expired")]
fn second_look_expires() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { pending_id, .. } = w.c.pay(m.args(&w.menu_sk, 1)) else { panic!() };
    owner(&w, T0 + 1000 + PENDING_TTL_MS + 1);
    w.c.approve(pending_id);
}

#[test]
fn declined_second_look_is_gone() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { pending_id, .. } = w.c.pay(m.args(&w.menu_sk, 1)) else { panic!() };
    owner(&w, T0 + 2000);
    w.c.decline(pending_id);
    assert!(w.c.get_pending(acc("alice.testnet")).is_empty());
}

#[test]
fn tripwire_freezes_after_three_rejected_attempts() {
    let mut w = world();
    let m = cafe_menu(T0);
    let mut bad = m.args(&w.menu_sk, 0);
    bad.price = U128(1);
    for i in 0..2 {
        agent(&w, T0 + 1000 + i);
        assert_eq!(rejected(w.c.pay(bad.clone())), (Reject::NotOnMenu, false));
    }
    agent(&w, T0 + 1010);
    assert_eq!(rejected(w.c.pay(bad.clone())), (Reject::NotOnMenu, true));
    // even a perfectly valid payment is now refused until the owner unfreezes
    agent(&w, T0 + 1020);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::Frozen);
    let cap = w.c.get_capsule(acc("alice.testnet")).unwrap();
    assert!(cap.frozen_reason.as_ref().unwrap().starts_with("tripwire"));
    assert_eq!(cap.attempts.len(), 4);
    owner(&w, T0 + 2000);
    w.c.unfreeze();
    agent(&w, T0 + 2001);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
}

#[test]
fn strikes_older_than_an_hour_do_not_count() {
    let mut w = world();
    let m = cafe_menu(T0);
    let mut bad = m.args(&w.menu_sk, 0);
    bad.price = U128(1);
    for i in 0..2 {
        agent(&w, T0 + i);
        w.c.pay(bad.clone());
    }
    agent(&w, T0 + STRIKE_WINDOW_MS + 10);
    assert_eq!(rejected(w.c.pay(bad)).1, false);
}

#[test]
fn new_merchant_draws_a_guard_warning() {
    let mut w = world();
    let fresh_key = key(40);
    ctx("newshop.testnet", &pk(&key(41)), T0 - 1000, NearToken::from_near(1));
    w.c.register_merchant("New Shop".into(), pk(&fresh_key), acc("newshop.testnet"));
    let m = Menu::new("newshop.testnet", &[(1, 1_000_000)], T0, 300_000, 1);
    let v = w.c.assess(acc("newshop.testnet"), None);
    assert_eq!(v.level, Level::Warn);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { reasons, .. } = w.c.pay(m.args(&fresh_key, 0)) else { panic!() };
    assert!(reasons.iter().any(|r| r.contains("registered less than 24 h ago")));
}

#[test]
fn changed_payout_draws_a_guard_warning() {
    let mut w = world();
    ctx("cafe.testnet", &pk(&key(31)), T0 - 1000, NearToken::from_near(0));
    w.c.set_payout(acc("attacker.testnet"));
    assert!(w.c.assess(acc("cafe.testnet"), None).reasons[0].contains("payout account changed"));
}

#[test]
fn blocklisted_merchant_is_blocked_even_with_a_valid_menu() {
    let mut w = world();
    ctx("arbiter.testnet", &w.owner_pk, T0, NearToken::from_near(0));
    w.c.block_account(acc("cafe.testnet"), "drained three agents".into(), None);
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::GuardBlock);
}

#[test]
fn unknown_merchant_is_rejected() {
    let mut w = world();
    let m = Menu::new("ghost.testnet", &[(1, 1)], T0, 300_000, 1);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::UnknownMerchant);
}

#[test]
fn two_owner_reports_make_the_guard_warn() {
    let mut w = world();
    ctx("bob.testnet", &pk(&key(50)), T0 - DAY, NearToken::from_millinear(100));
    w.c.create_capsule(rules(), None);
    let ev = hex::encode([7u8; 32]);
    owner(&w, T0);
    w.c.report(acc("cafe.testnet"), ev.clone(), "charged twice".into());
    assert_eq!(w.c.assess(acc("cafe.testnet"), None).level, Level::Allow);
    ctx("bob.testnet", &pk(&key(50)), T0, NearToken::from_near(0));
    w.c.report(acc("cafe.testnet"), ev, "same".into());
    assert_eq!(w.c.assess(acc("cafe.testnet"), None).level, Level::Warn);
}

#[test]
fn failed_payout_refunds_the_capsule_and_frees_the_nullifier() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0));
    w.c.on_payout(0, Err(PromiseError::Failed));
    let cap = w.c.get_capsule(acc("alice.testnet")).unwrap();
    assert_eq!(cap.balance.0, 100 * USDC);
    assert_eq!(cap.spent_in_cycle.0, 0);
    assert_eq!(w.c.get_receipt(0).unwrap().status, ReceiptStatus::Refunded);
    agent(&w, T0 + 2000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
}

#[test]
fn insufficient_balance_is_rejected() {
    let mut w = world();
    owner(&w, T0);
    let _ = w.c.withdraw(U128(98 * USDC));
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::InsufficientBalance);
}

#[test]
fn other_tokens_are_returned() {
    let mut w = world();
    ctx("fake-usdc.testnet", &w.owner_pk, T0, NearToken::from_near(0));
    let near_sdk::PromiseOrValue::Value(back) = w.c.ft_on_transfer(acc("alice.testnet"), U128(5), String::new()) else { panic!() };
    assert_eq!(back.0, 5);
}

#[test]
fn expired_capsule_refuses_agent() {
    let mut w = world();
    let m = Menu::new("cafe.testnet", &[(1, 4_500_000)], T0 + 31 * DAY, 300_000, 1);
    agent(&w, T0 + 31 * DAY + 1);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::Expired);
}

#[test]
#[should_panic(expected = "NotOnMenu")]
fn owner_signed_violation_panics_instead_of_striking() {
    let mut w = world();
    let mut a = cafe_menu(T0).args(&w.menu_sk, 0);
    a.price = U128(1);
    owner(&w, T0 + 1000);
    w.c.pay(a);
}

#[test]
fn owner_can_pay_pricier_item_directly() {
    let mut w = world();
    let m = cafe_menu(T0);
    owner(&w, T0 + 1000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 1)), PayOutcome::Paid { .. }));
    assert!(w.c.get_receipt(0).unwrap().cosigned);
}

fn relayed(w: &World, ms: u64) {
    // NEP-366: the relayer signs the outer transaction; the owner is the predecessor
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("tally.testnet"))
        .predecessor_account_id(acc("alice.testnet"))
        .signer_account_id(acc("relayer.testnet"))
        .signer_account_pk(w.owner_pk.clone())
        .block_timestamp(ms * 1_000_000);
    testing_env!(b.build());
}

#[test]
fn relayed_pay_is_held_to_agent_rules() {
    let mut w = world();
    let m = cafe_menu(T0);
    relayed(&w, T0 + 1000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 0)), PayOutcome::Paid { .. }));
    assert!(!w.c.get_receipt(0).unwrap().cosigned);
    relayed(&w, T0 + 2000);
    assert!(matches!(w.c.pay(m.args(&w.menu_sk, 1)), PayOutcome::SecondLook { .. }), "a relayed pricier pick never counts as the owner");
    let mut bad = m.args(&w.menu_sk, 2);
    bad.price = U128(1);
    relayed(&w, T0 + 3000);
    assert_eq!(rejected(w.c.pay(bad)).0, Reject::NotOnMenu);
}

#[test]
#[should_panic(expected = "the agent key was revoked")]
fn relayed_pay_refused_after_the_agent_is_revoked() {
    let mut w = world();
    owner(&w, T0);
    w.c.set_agent_key(None);
    relayed(&w, T0 + 1000);
    w.c.pay(cafe_menu(T0).args(&w.menu_sk, 0));
}

#[test]
#[should_panic(expected = "owner must sign directly")]
fn owner_actions_cannot_be_relayed() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    let PayOutcome::SecondLook { pending_id, .. } = w.c.pay(m.args(&w.menu_sk, 1)) else { panic!() };
    relayed(&w, T0 + 2000);
    w.c.approve(pending_id);
}

#[test]
fn preview_matches_pay() {
    let w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(w.c.preview_pay(acc("alice.testnet"), m.args(&w.menu_sk, 0)).outcome, "paid");
    assert_eq!(w.c.preview_pay(acc("alice.testnet"), m.args(&w.menu_sk, 1)).outcome, "second_look");
    assert_eq!(w.c.preview_pay(acc("alice.testnet"), m.args(&w.menu_sk, 3)).code, Some(Reject::Category));
    assert!(w.c.get_capsule(acc("alice.testnet")).unwrap().attempts.is_empty());
}

#[test]
fn floor_fraud_slashes_bond_and_blocklists_merchant() {
    let mut w = world();
    // The merchant claims the 5.90 coffee is the cheapest coffee while selling one at 4.50.
    let mut m = cafe_menu(T0);
    m.items[1].floor = 5_900_000;
    m.tree = MerkleTree::new(m.items.iter().map(leaf_hash).collect());
    let sig = hex::encode(w.menu_sk.sign(&m.header()).to_bytes());
    ctx("watcher.testnet", &pk(&key(60)), T0 + 1000, NearToken::from_near(0));
    let _ = w.c.prove_floor_fraud(acc("cafe.testnet"), hex::encode(m.tree.root()), m.issued, m.expires, m.nonce, 4, sig, m.leaf(0), m.leaf(1));
    let mer = w.c.get_merchant(acc("cafe.testnet")).unwrap();
    assert_eq!(mer.bond.0, NearToken::from_millinear(500).as_yoctonear());
    assert!(!mer.active);
    assert_eq!(w.c.assess(acc("cafe.testnet"), None).level, Level::Block);
}

#[test]
#[should_panic(expected = "no contradiction")]
fn honest_menu_cannot_be_called_fraud() {
    let mut w = world();
    let m = cafe_menu(T0);
    let sig = hex::encode(w.menu_sk.sign(&m.header()).to_bytes());
    ctx("watcher.testnet", &pk(&key(60)), T0 + 1000, NearToken::from_near(0));
    let _ = w.c.prove_floor_fraud(acc("cafe.testnet"), hex::encode(m.tree.root()), m.issued, m.expires, m.nonce, 4, sig, m.leaf(0), m.leaf(1));
}

#[test]
fn rotated_key_stops_paying_but_stays_slashable() {
    let mut w = world();
    ctx("cafe.testnet", &pk(&key(31)), T0 - DAY, NearToken::from_near(0));
    w.c.rotate_signing_key(pk(&key(32)));
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    assert_eq!(rejected(w.c.pay(m.args(&w.menu_sk, 0))).0, Reject::BadSignature);
    assert_eq!(w.c.get_merchant(acc("cafe.testnet")).unwrap().key_history.len(), 2);
}

#[test]
fn upheld_dispute_slashes_bond_to_the_owner() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0));
    w.c.on_payout(0, Ok(()));
    owner(&w, T0 + 2000);
    w.c.open_dispute(0, hex::encode([9u8; 32]));
    assert_eq!(w.c.assess(acc("cafe.testnet"), None).level, Level::Warn);
    ctx("arbiter.testnet", &w.owner_pk, T0 + 3000, NearToken::from_near(0));
    let _ = w.c.resolve_dispute(0, true, U128(NearToken::from_millinear(200).as_yoctonear()), false);
    let mer = w.c.get_merchant(acc("cafe.testnet")).unwrap();
    assert_eq!(mer.slashed_total.0, NearToken::from_millinear(200).as_yoctonear());
    assert_eq!(mer.open_disputes, 0);
    assert_eq!(w.c.get_receipt(0).unwrap().status, ReceiptStatus::DisputeUpheld);
    // bond (0.8 NEAR) still above the 0.5 minimum, so the merchant is not auto-blocked
    assert_eq!(w.c.assess(acc("cafe.testnet"), None).level, Level::Allow);
}

#[test]
#[should_panic(expected = "open disputes")]
fn bond_cannot_leave_while_disputed() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0));
    w.c.on_payout(0, Ok(()));
    owner(&w, T0 + 2000);
    w.c.open_dispute(0, hex::encode([9u8; 32]));
    ctx("cafe.testnet", &pk(&key(31)), T0 + 3000, NearToken::from_near(0));
    w.c.request_bond_unlock();
    ctx("cafe.testnet", &pk(&key(31)), T0 + 3000 + 2 * 60 * 60 * 1000, NearToken::from_near(0));
    let _ = w.c.withdraw_bond(U128(1));
}

#[test]
fn family_can_top_up_someone_elses_capsule() {
    let mut w = world();
    ctx("tusdc.testnet", &w.owner_pk, T0, NearToken::from_near(0));
    let msg = r#"{"owner":"alice.testnet","note":"lunch money"}"#.to_string();
    let near_sdk::PromiseOrValue::Value(back) = w.c.ft_on_transfer(acc("mum.testnet"), U128(5 * USDC), msg) else { panic!() };
    assert_eq!(back.0, 0);
    let cap = w.c.get_capsule(acc("alice.testnet")).unwrap();
    assert_eq!(cap.balance.0, 105 * USDC);
    let t = cap.topups.last().unwrap();
    assert_eq!((t.from.as_str(), t.note.as_str()), ("mum.testnet", "lunch money"));
    let near_sdk::PromiseOrValue::Value(back) = w.c.ft_on_transfer(acc("mum.testnet"), U128(1), r#"{"owner":"nobody.testnet"}"#.into()) else { panic!() };
    assert_eq!(back.0, 1);
    let near_sdk::PromiseOrValue::Value(back) = w.c.ft_on_transfer(acc("mum.testnet"), U128(1), "garbage".into()) else { panic!() };
    assert_eq!(back.0, 1);
}

#[test]
fn sales_are_listed_per_merchant() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0));
    assert_eq!(w.c.get_sales(acc("cafe.testnet"), None).len(), 1);
    assert!(w.c.get_sales(acc("other.testnet"), None).is_empty());
}

#[test]
fn receipt_digest_binds_every_field_and_the_mpc_answer_is_stored() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0));
    w.c.on_payout(0, Ok(()));
    let d0 = w.c.receipt_digest(0).unwrap();
    assert_eq!(d0.len(), 64);
    let mut r = w.c.get_receipt(0).unwrap().clone();
    r.price = U128(1);
    assert_ne!(hex::encode(crate::portable::digest_of(&acc("tally.testnet"), &r)), d0);
    // what v1.signer-prod.testnet returns
    let answer = near_sdk::serde_json::json!({ "scheme": "Secp256k1", "big_r": { "affine_point": "02ab" }, "s": { "scalar": "cd" }, "recovery_id": 1 });
    let p = w.c.on_receipt_signed(0, d0.clone(), "ee".into(), Ok(answer)).unwrap();
    assert_eq!((p.big_r.as_str(), p.s.as_str(), p.recovery_id), ("02ab", "cd", 1));
    assert_eq!(w.c.get_receipt_signature(0).unwrap().digest, d0);
    assert_eq!(p.signer.as_str(), "v1.signer-prod.testnet");
}

#[test]
#[should_panic(expected = "only settled receipts are signed")]
fn unsettled_receipts_are_not_signed() {
    let mut w = world();
    let m = cafe_menu(T0);
    agent(&w, T0 + 1000);
    w.c.pay(m.args(&w.menu_sk, 0)); // still `sending`
    ctx("bob.testnet", &w.owner_pk, T0 + 2000, NearToken::from_yoctonear(1));
    let _ = w.c.sign_receipt(0);
}
