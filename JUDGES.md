# For judges

A one-page map from every claim to the code, a way to reproduce it, and the evidence. Nothing here needs
keys: tests run offline, and live state is readable on NEAR testnet.

**Live app** https://tally-near.adoranto737.workers.dev · **Contract** [`tallynear.testnet`](https://testnet.nearblocks.io/address/tallynear.testnet)
· **One command** `./scripts/verify.sh` (`SANDBOX=1` adds the local-node tests) · **Evidence index** [docs/proofs.md](docs/proofs.md), [VERIFY.md](VERIFY.md)

## Executive summary

AI agents are starting to pay for things. Today that means handing a model a card or a key and hoping
nobody talks it into a bad payment. The payments industry names prompt injection as the new fraud vector
([U.S. Payments Forum, 2026](https://www.uspaymentsforum.org/wp-content/uploads/2026/07/USPF-Agentic-Commerce_A-Primer-for-the-Payments-Industry-White-Paper.pdf);
[J.P. Morgan, 2026](https://www.jpmorgan.com/payments/newsroom/ai-agent-controls-payments): *"A prompt expresses intent; it does not enforce authority"*).

**Tally enforces authority on-chain.** An agent may pay only for an item a merchant signed, at the signed
price, to the merchant's registered account, inside rules only the owner can change. The agent holds a
NEAR function-call key that can call `pay` on the Tally contract and nothing else. Anything unusual waits
for the owner's Face ID. Three bad attempts freeze the agent.

## Why it's hard to replicate

* The contract **hashes the catalog leaf itself** and verifies an **Ed25519 merchant signature on-chain**
  over a header bound to *this* contract and *this* merchant: the agent can't invent a price or a payee.
* It tells **which key signed** (`env::signer_account_pk`) and treats agent, owner and relayer differently,
  including the subtle NEP-366 case where the relayer is the signer.
* Price fairness is **provable**: each leaf carries the merchant-certified cheapest price in its category, so
  a self-contradicting menu can be proven on-chain and slashed by anyone.
* Settlement is **asynchronous and safe**: payouts that bounce refund the capsule, restore the cap and free the
  nullifier; closing waits for in-flight transfers (audit fix TAL-01).
* Eight NEAR products are wired into one working flow, each with live proof (table below).

## Claims and evidence

| # | Claim | How it works | Code | Reproduce | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | The agent can only call `pay` | NEAR function-call key: receiver `tallynear.testnet`, method `pay`, no deposit | `web/lib/tally.ts` (`createAllowance`), `packages/demo/src/seed.ts` | sandbox test or attack demo | [attack-log](docs/attack-log.md) steps 6–8: `AccessKeyRequiresFullAccess`, `MethodNameMismatch`, `ReceiverMismatch`; sandbox `the_protocol_refuses_everything_else_the_agent_key_tries` |
| 2 | A changed price or fake menu never pays | contract rebuilds the 144-byte header, `ed25519_verify`, Merkle proof of a leaf it hashes | `contracts/tally/src/pay.rs`, `crates/tally-menu` | `cargo test -p tally` | `tampered_price_is_not_on_menu`, `menu_signed_by_another_key_is_refused`, `signature_for_another_deployment_does_not_replay` |
| 3 | The owner's rules bind the agent | category list, per-purchase and rolling 24 h caps, balance, expiry, nullifier | `pay.rs` `check` | `cargo test -p tally` | `category_and_caps_are_enforced`, `daily_cap_rolls_over_after_24h`, `same_menu_item_cannot_be_paid_twice` |
| 4 | Anything unusual waits for the owner | not cheapest / extended menu / Guard warning → `second_look`; only a direct owner signature approves | `pay.rs` `pay`, `approve` | app: Large oat latte | screenshot `08-second-look`; `pricier_pick_waits_for_owner_then_pays_on_approve`, `agent_key_cannot_approve_its_own_second_look` |
| 5 | A hijacked agent locks itself out | rejected agent calls return `rejected` and count; 3 in an hour freeze the capsule | `pay.rs` `record_strike` | `pnpm --filter @tally-near/demo attack` | attack-log steps 2–5; `tripwire_freezes_after_three_rejected_attempts` |
| 6 | Counterparty Guard | on-chain verdict from blocklist, bond, merchant age, payout/key changes, disputes, reports; agent-side adds account age and code-hash pins | `guard.rs`, `packages/sdk/src/guard.ts` | `near contract call-function as-read-only tallynear.testnet assess json-args '{"merchant_id":"tallynear-shady.testnet"}' network-config testnet now` | `"level": "block"`; `packages/sdk/test/guard.test.ts` |
| 7 | The model never sees merchant text | context firewall: category, price, floor, dictionary words only | `packages/agent/src/firewall.ts`, `web/lib/firewall.ts` | unit tests | attack-log step 1 shows the injected note; `firewall shows only category, price…` |
| 8 | Gasless agent (NEP-366) | delegate action + relayer; relayed pay held to agent rules | `packages/sdk/src/relay.ts`, `web/app/api/relay/route.ts`, `pay.rs` | `TALLY_RELAY_URL=…/api/relay pnpm --filter @tally-near/agent buy "a croissant"` | [proofs §1](docs/proofs.md#1-gasless-agent-payments-nep-366-meta-transactions) |
| 9 | DAO-ruled disputes | Sputnik DAO is the arbiter; council vote executes `resolve_dispute` | `dispute.rs`, `packages/demo/src/dao.ts` | `pnpm --filter @tally-near/demo dao` | [proofs §2](docs/proofs.md#2-sputnik-dao-is-the-arbiter) |
| 10 | Verified private AI | Intel TDX quote verified with DCAP (QE identity included); quote binds the gateway key and our nonce | `packages/agent/src/attestation.ts` | `pnpm --filter @tally-near/agent verify-tee` | [proofs §3](docs/proofs.md#3-near-ai-cloud-tee-verified-intel-tdx); receipt #24 `nearai-tdx:UpToDate:…` |
| 11 | The deployed code is this code | reproducible Docker build + NEP-330 metadata | `contracts/tally/Cargo.toml` | `cargo near build reproducible-wasm` at the named commit | [proofs §4](docs/proofs.md#4-verifiable-contract-reproducible-build--nep-330-source-metadata): code hash `EVP9Y5zk…` |
| 12 | Hireable on the Agent Market | Tally Guard worker agent, live $1 plan, delivers Guard reports | `packages/agent/src/market.ts` | `curl https://api.market.near.ai/v1/agents/tally-guard` | [proofs §5](docs/proofs.md#5-near-ai-agent-market-tally-guard-a-hireable-agent) |
| 13 | Receipts any EVM chain can verify | contract asks NEAR's MPC network to sign the EIP-191 hash of a receipt digest | `contracts/tally/src/portable.rs`, `packages/sdk/src/portable.ts` | `pnpm --filter @tally-near/demo portable 24` | [proofs §6](docs/proofs.md#6-near-chain-signatures-portable-receipts); offline test on the live signature |
| 14 | Cross-chain family top-ups | NEAR Intents 1Click deposit address, USDC from Base/Arbitrum/Ethereum/Polygon → NEAR | `web/app/api/intents`, `web/components/IntentsQuote.tsx` | `curl -X POST …/api/intents` | [proofs §7](docs/proofs.md#7-near-intents-real-cross-chain-top-ups); screenshot `13-family-topup` |
| 15 | No wallet needed | passkey PRF → implicit account; sponsor funds it | `web/lib/passkey.ts`, `web/app/api/onboard` | open the live app | screenshots `01`–`04`; `web/test/passkey.test.ts` |
| 16 | Existing NEAR users welcome | HOT near-connect wallet sign-in; the wallet signs owner actions | `web/lib/wallet.ts` | live app → "Have a NEAR wallet?" | [proofs §8](docs/proofs.md#8-near-wallet-sign-in-hot-near-connect) |
| 17 | Audited and fixed | internal review: 12 findings, 7 fixed, rest accepted with reasons | — | read the report | [SECURITY.md](SECURITY.md) |

## Demonstrable user workflows

| Workflow | Where | Proof |
| --- | --- | --- |
| Sign up, open allowance, pay a café | live app | screenshots [01–07](docs/images/app/) |
| Pricier pick → Face ID approval | live app | screenshots 08–09 |
| Red team your own agent | live app → Settings → Attack | screenshot 10 |
| Family top-up incl. cross-chain | `/send/<account>` | screenshot 13 |
| Shop from Claude/Codex via MCP | `packages/agent` | `pnpm --filter @tally-near/agent mcp:smoke` |
| Prompt-injected agent vs testnet | terminal | [docs/attack-log.md](docs/attack-log.md) |

## Testing, security, deployment

* Tests and real results: [TESTING.md](TESTING.md).
* Security review, findings and fixes: [SECURITY.md](SECURITY.md); attacker table: [docs/threat-model.md](docs/threat-model.md).
* Deployments and how to reproduce them: [DEPLOYMENT.md](DEPLOYMENT.md).
* Architecture and diagrams: [ARCHITECTURE.md](ARCHITECTURE.md). Integrations: [INTEGRATIONS.md](INTEGRATIONS.md). API: [API.md](API.md).

## Business

Agentic commerce is forecast to grow from ~$8 bn of transactions in 2026 to ~$3.5 tn in 2031
([Juniper Research, 2026](https://www.juniperresearch.com/research/fintech-payments/ecommerce/agentic-commerce-research-report/)).
Card networks and AI platforms are building the *rails* (Visa Intelligent Commerce, Mastercard Agent Pay,
Google AP2, Stripe/OpenAI ACP, Coinbase x402). Tally is the *control layer*: merchant-signed price
commitments and owner rules enforced by a contract. Details, customers and revenue model: [BUSINESS.md](BUSINESS.md).

## Honest limits

Testnet only; tUSDC is a faucet token. No third-party audit. The Cloudflare app records a nonce-bound TEE
quote digest; full DCAP verification runs in the agent. Intents swaps and Agent Market hires need real money,
so their end-to-end runs are pending (the integration points are live). Built at NEAR HACKATHON; the app's
screens and brand come from the author's earlier Tally prototype (see README, "Origin").
