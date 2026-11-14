//! Tally on a local NEAR sandbox: the real wasm, a real NEP-141 token, a real function-call key.
//! No testnet account or funds needed:
//!     cargo test -p tally --test sandbox -- --nocapture
//! What unit tests can't show: the protocol refusing the agent key, and token callbacks settling or
//! rolling back across receipts.
use ed25519_dalek::{Signer as _, SigningKey};
use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};
use tally_menu::header::{build_header, HeaderFields};
use tally_menu::menu::{compute_floors, leaf_hash, Item};
use tally_menu::merkle::MerkleTree;

type R<T = ()> = Result<T, Box<dyn std::error::Error>>;
const USDC: u128 = 1_000_000;

struct World {
    worker: Worker<Sandbox>,
    tally: Contract,
    token: Contract,
    owner: Account,
    agent: Account,
    merchant: Account,
    menu_key: SigningKey,
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

async fn world(payout_registered: bool) -> R<World> {
    let worker = near_workspaces::sandbox().await?;
    let tally = worker.dev_deploy(&near_workspaces::compile_project("./").await?).await?;
    let token = worker.dev_deploy(&near_workspaces::compile_project("../tusdc").await?).await?;
    let arbiter = worker.dev_create_account().await?;
    token.call("new").transact().await?.into_result()?;
    tally.call("new").args_json(json!({ "arbiter": arbiter.id(), "token": token.id() })).transact().await?.into_result()?;
    // a short Guard window so a merchant registered seconds ago isn't "new" in the test
    tally.call("set_config").args_json(json!({ "new_merchant_ms": 1, "new_key_ms": 1 })).transact().await?.into_result()?;
    tally.as_account().call(token.id(), "mint").args_json(json!({ "amount": "0" })).transact().await?.into_result()?;

    let merchant = worker.dev_create_account().await?;
    let menu_key = SigningKey::from_bytes(&[7; 32]);
    let pk = format!("ed25519:{}", bs58::encode(menu_key.verifying_key().as_bytes()).into_string());
    merchant
        .call(tally.id(), "register_merchant")
        .args_json(json!({ "name": "Sandbox Cafe", "signing_key": pk, "payout": merchant.id() }))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    if payout_registered {
        merchant.call(token.id(), "mint").args_json(json!({ "amount": "0" })).transact().await?.into_result()?;
    }

    let owner = worker.dev_create_account().await?;
    owner.call(token.id(), "mint").args_json(json!({ "amount": (100 * USDC).to_string() })).transact().await?.into_result()?;
    let agent_sk = SecretKey::from_random(KeyType::ED25519);
    let rules = json!({
        "per_tx_cap": (10 * USDC).to_string(), "daily_cap": (25 * USDC).to_string(), "categories": [3],
        "min_merchant_bond": "0", "expiry_ms": 4_102_444_800_000u64, "allow_extended": false, "tripwire": 3
    });
    owner
        .call(tally.id(), "create_capsule")
        .args_json(json!({ "rules": rules, "agent_key": agent_sk.public_key() }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?;
    // the agent's key: on the owner's own account, may only call `pay` on Tally
    owner
        .batch(owner.id())
        .add_key(agent_sk.public_key(), AccessKey::function_call_access(tally.id(), &["pay"], Some(NearToken::from_near(3))))
        .transact()
        .await?
        .into_result()?;
    owner
        .call(token.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": tally.id(), "amount": (50 * USDC).to_string(), "msg": "" }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let agent = Account::from_secret_key(owner.id().clone(), agent_sk, &worker);
    Ok(World { worker, tally, token, owner, agent, merchant, menu_key })
}

/// A freshly signed two-coffee menu; returns `pay` args for item `i`.
async fn args(w: &World, i: usize, nonce: u64) -> R<Value> {
    let now_ms = w.worker.view_block().await?.timestamp() / 1_000_000;
    let mut items = vec![
        Item { id: [1; 16], category: 3, price: 4_500_000, floor: 0 },
        Item { id: [2; 16], category: 3, price: 5_900_000, floor: 0 },
    ];
    compute_floors(&mut items);
    let tree = MerkleTree::new(items.iter().map(leaf_hash).collect());
    let (issued, expires) = (now_ms - 5_000, now_ms + 300_000);
    let header = build_header(&HeaderFields {
        contract_id: w.tally.id().as_str(),
        merchant_id: w.merchant.id().as_str(),
        menu_root: tree.root(),
        issued_at_ms: issued,
        expires_at_ms: expires,
        menu_nonce: nonce,
        item_count: 2,
    });
    Ok(json!({
        "merchant_id": w.merchant.id(), "menu_root": hex(&tree.root()), "issued_at_ms": issued, "expires_at_ms": expires,
        "menu_nonce": nonce, "item_count": 2, "item_id": hex(&items[i].id), "category": 3,
        "price": items[i].price.to_string(), "floor": items[i].floor.to_string(),
        "proof": tree.proof(i).iter().map(|p| hex(p)).collect::<Vec<_>>(),
        "signature": hex(&w.menu_key.sign(&header).to_bytes()), "memo": "sandbox", "attestation": null
    }))
}

async fn balance(w: &World, who: &Account) -> R<u128> {
    let v: String = w.token.view("ft_balance_of").args_json(json!({ "account_id": who.id() })).await?.json()?;
    Ok(v.parse()?)
}

async fn agent_pay(w: &World, a: Value) -> R<Value> {
    Ok(w.agent.call(w.tally.id(), "pay").args_json(json!({ "args": a })).gas(near_workspaces::types::Gas::from_tgas(100)).transact().await?.into_result()?.json()?)
}

#[tokio::test]
async fn agent_key_pays_a_signed_menu_and_the_merchant_receives_tokens() -> R {
    let w = world(true).await?;
    let out = agent_pay(&w, args(&w, 0, 1).await?).await?;
    println!("agent pay -> {out}");
    assert_eq!(out["status"], "paid");
    assert_eq!(balance(&w, &w.merchant).await?, 4_500_000);
    let r: Value = w.tally.view("get_receipt").args_json(json!({ "receipt_id": 0 })).await?.json()?;
    assert_eq!(r["status"], "settled");
    assert_eq!(r["cosigned"], false);
    Ok(())
}

#[tokio::test]
async fn the_protocol_refuses_everything_else_the_agent_key_tries() -> R {
    let w = world(true).await?;
    let rules = json!({ "per_tx_cap": "1", "daily_cap": "1", "categories": [], "min_merchant_bond": "0", "expiry_ms": 1, "allow_extended": false, "tripwire": 0 });
    let r = w.agent.call(w.tally.id(), "update_rules").args_json(json!({ "rules": rules })).transact().await;
    println!("agent update_rules -> {:?}", r.as_ref().map(|o| o.is_success()).map_err(|e| e.to_string()));
    assert!(r.is_err(), "method outside the key's scope must be refused");
    let r = w.agent.call(w.token.id(), "ft_transfer").args_json(json!({ "receiver_id": w.merchant.id(), "amount": "1" })).transact().await;
    assert!(r.is_err(), "a different receiver must be refused");
    let r = w.agent.transfer_near(w.merchant.id(), NearToken::from_millinear(10)).await;
    assert!(r.is_err() || !r.unwrap().is_success(), "a NEAR transfer must be refused");
    assert_eq!(balance(&w, &w.merchant).await?, 0);
    Ok(())
}

#[tokio::test]
async fn pricier_pick_parks_for_the_owner_who_approves_it() -> R {
    let w = world(true).await?;
    let out = agent_pay(&w, args(&w, 1, 2).await?).await?;
    assert_eq!(out["status"], "second_look");
    assert_eq!(balance(&w, &w.merchant).await?, 0);
    let paid: Value = w
        .owner
        .call(w.tally.id(), "approve")
        .args_json(json!({ "pending_id": out["pending_id"] }))
        .max_gas()
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert_eq!(paid["status"], "paid");
    assert_eq!(balance(&w, &w.merchant).await?, 5_900_000);
    Ok(())
}

#[tokio::test]
async fn a_bounced_payout_refunds_the_capsule() -> R {
    let w = world(false).await?; // the merchant's payout account never registered with the token
    let out = agent_pay(&w, args(&w, 0, 3).await?).await?;
    assert_eq!(out["status"], "paid"); // the contract committed; the token transfer then bounces
    let r: Value = w.tally.view("get_receipt").args_json(json!({ "receipt_id": 0 })).await?.json()?;
    println!("receipt after bounced payout -> {}", r["status"]);
    assert_eq!(r["status"], "refunded");
    let c: Value = w.tally.view("get_capsule").args_json(json!({ "owner": w.owner.id() })).await?.json()?;
    assert_eq!(c["balance"], (50 * USDC).to_string());
    assert_eq!(c["spent_in_cycle"], "0");
    Ok(())
}

#[tokio::test]
async fn three_bad_attempts_freeze_the_capsule() -> R {
    let w = world(true).await?;
    for n in 0..3 {
        let mut a = args(&w, 0, 10 + n).await?;
        a["price"] = json!("1");
        let out = agent_pay(&w, a).await?;
        println!("tampered pay #{n} -> {} {}", out["code"], out["frozen"]);
        assert_eq!(out["code"], "not_on_menu");
    }
    let out = agent_pay(&w, args(&w, 0, 20).await?).await?;
    assert_eq!(out["code"], "frozen");
    w.owner.call(w.tally.id(), "unfreeze").transact().await?.into_result()?;
    assert_eq!(agent_pay(&w, args(&w, 0, 21).await?).await?["status"], "paid");
    Ok(())
}
