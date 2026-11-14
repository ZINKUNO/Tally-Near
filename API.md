# API

Four surfaces: the **contract**, the app's **HTTP API**, the **TypeScript SDK** and the **MCP server**.

## 1. Contract (`tallynear.testnet`)

Method-by-caller table and the `PayArgs` shape: [contracts/tally/README.md](contracts/tally/README.md).
Byte formats (signed header, leaf, Merkle tree): [crates/tally-menu](crates/tally-menu/src), worked example in
[fixtures/vectors.json](fixtures/vectors.json).

`pay` returns one of:

```json
{ "status": "paid", "receipt_id": 24 }
{ "status": "second_look", "pending_id": 3, "reasons": ["not the cheapest in category 3 (floor 4500000)"] }
{ "status": "rejected", "code": "not_on_menu", "reason": "this item, at this price, is not on the signed menu", "frozen": false }
```

Reject codes: `frozen`, `expired`, `unknown_merchant`, `merchant_inactive`, `guard_block`, `bad_signature`,
`stale`, `window_too_long`, `not_on_menu`, `category`, `over_per_tx`, `over_daily`, `insufficient_balance`,
`duplicate`, `bad_args`, `too_many_pending`.

Read-only examples:

```bash
near contract call-function as-read-only tallynear.testnet preview_pay json-args '{"owner":"…","args":{…}}' network-config testnet now
near contract call-function as-read-only tallynear.testnet assess json-args '{"merchant_id":"tallynear-cafe.testnet"}' network-config testnet now
near contract call-function as-read-only tallynear.testnet get_receipt_signature json-args '{"receipt_id":24}' network-config testnet now
```

## 2. App HTTP API (`https://tally-near.adoranto737.workers.dev/api`)

All routes are rate-limited per IP (in-memory per Worker isolate; see SECURITY.md TAL-10).

| Route | Method | Body / query | Returns |
| --- | --- | --- | --- |
| `/api/onboard` | POST | `{ "owner": "<64-hex implicit or name.testnet>" }` | `{ ok, welcomeUsd }`: sponsor sends 0.6 NEAR to new implicit accounts and mints $50 tUSDC |
| `/api/relay` | POST | `{ "delegate": "<base64 borsh SignedDelegate>" }` | `{ hash, outcome, relayer }`; 400 unless it is exactly one `pay` to Tally with no deposit |
| `/api/agent` | POST | firewalled payload `{ request, rules, menu[] }` | `{ item_id, reason, by: "near-ai" \| "rules", attestation }` |
| `/api/counter` | GET | — | `{ qr, expiresAt, now }`: a freshly signed demo-café menu |
| `/api/quote` | GET | `?from=base&usd=20` | dry NEAR Intents quote `{ amountIn, amountOut, timeEstimate, fee }` |
| `/api/intents` | POST | `{ from, usd, recipient, refundTo }` | live 1Click deposit `{ depositAddress, amountIn, amountOut, deadline, timeEstimate }` |
| `/api/intents` | GET | `?depositAddress=…` | `{ status, amountOut?, txHashes? }` |

## 3. TypeScript SDK (`packages/sdk`)

| Export | Purpose |
| --- | --- |
| `signMenu`, `verifyMenu`, `payArgs`, `MerkleTree`, `buildHeader` | merchant menus, byte-identical to the contract |
| `TallyClient` | typed views over failover RPC |
| `AgentWallet.pay`, `.payGasless` | pay with the function-call key, directly or through a relayer |
| `signPayDelegate`, `checkPayDelegate` | NEP-366 delegate signing and the relayer's guard |
| `checkCounterparty` | on-chain Guard + agent-side signals → `sign` / `ask_human` / `refuse` |
| `verifyPortable`, `derivedPublicKey`, `receiptDigest` | verify Chain Signatures receipts offline |
| `quoteRequest`, `depositRequest`, `parseStatus` | NEAR Intents |

## 4. MCP server (`packages/agent`, stdio)

| Tool | Does |
| --- | --- |
| `tally_status` | capsule balance, headroom, frozen state, receipts, waiting Second Looks |
| `tally_menu` | fetch + verify a merchant menu, firewalled |
| `tally_check_merchant` | counterparty check |
| `tally_buy` | one purchase end to end |
| `tally_verify_tee` | Intel DCAP verification of NEAR AI Cloud |
| `tally_quote_topup` | live NEAR Intents price for a cross-chain top-up |
