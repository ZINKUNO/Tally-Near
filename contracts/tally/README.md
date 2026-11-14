# Tally contract

near-sdk 5. Deployed on testnet as `tallynear.testnet`. Build: `cargo near build non-reproducible-wasm`.
Tests: `cargo test -p tally` (42 unit tests + 5 sandbox tests on a local NEAR node).

## Methods

| Who | Method | What it does |
| --- | --- | --- |
| deployer | `new(arbiter, token)` | init: arbiter account, the NEP-141 stablecoin |
| admin | `set_config(arbiter?, min_bond?, slash_bps?, bond_unlock_delay_ms?, new_merchant_ms?, new_key_ms?)` | economic and Guard parameters |
| merchant | `register_merchant(name, signing_key, payout)` + NEAR bond | join the registry |
| merchant | `rotate_signing_key`, `set_payout`, `set_active`, `top_up_bond`, `request_bond_unlock`, `withdraw_bond` | manage the counter (payout and key changes draw Guard warnings) |
| owner | `create_capsule(rules, agent_key?)` + 0.1 NEAR | open a capsule; `agent_key` is the function-call key's public key |
| owner | `update_rules`, `set_agent_key`, `freeze`, `unfreeze`, `withdraw`, `close_capsule` | refused when signed by the agent key |
| token | `ft_on_transfer(sender, amount, msg)` | `msg` `""` funds the sender's capsule; `{"owner":…,"note":…}` funds someone else's |
| agent | `pay(args)` → `paid` / `second_look` / `rejected` | the checks in `src/pay.rs`; rejections are strikes, three freeze the capsule |
| owner | `approve(pending_id)`, `decline(pending_id)` | decide a Second Look |
| owner | `report(account_id, evidence_hash, note)` | counterparty report; two make the Guard warn |
| owner | `open_dispute(receipt_id, evidence_hash)` | within 7 days of a settled purchase |
| arbiter | `resolve_dispute(receipt_id, upheld, slash, block)`, `block_account`, `unblock_account` | rulings and the shared blocklist |
| anyone | `sign_receipt(receipt_id)` + 1 yoctoNEAR | NEAR Chain Signatures: the MPC network signs a settled receipt with Tally's derived secp256k1 key |
| anyone | `prove_floor_fraud(merchant_id, header…, signature, cheap, claimed)` | slash half the bond for a self-contradicting signed menu |

Views: `get_config`, `stats`, `get_merchant`, `list_merchants`, `get_capsule`, `get_receipt`,
`get_receipts`, `get_sales`, `get_pending`, `assess(merchant_id, owner?)`, `preview_pay(owner, args)`,
`remaining_today`, `get_blocklist`, `get_reports`, `get_dispute`.

## `PayArgs`

```json
{
  "merchant_id": "tallynear-cafe.testnet",
  "menu_root": "<64 hex>", "issued_at_ms": 0, "expires_at_ms": 0, "menu_nonce": 0, "item_count": 6,
  "item_id": "<32 hex>", "category": 3, "price": "4500000", "floor": "4500000",
  "proof": ["<64 hex>", "…"], "signature": "<128 hex>",
  "memo": "one line from the agent", "attestation": "nearai-gw:<digest>:<nonce>"
}
```

The signed bytes are defined in `crates/tally-menu/src/header.rs`; `fixtures/vectors.json` has a worked example.
