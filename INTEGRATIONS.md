# Integrations

What each external system does for Tally, where it is wired in, and its live status. Evidence for each
row is in [docs/proofs.md](docs/proofs.md).

## NEAR protocol

| Feature | Used for | Code | Status |
| --- | --- | --- | --- |
| Function-call access keys | the agent's key: `pay` on Tally only, no deposits, gas allowance | `web/lib/tally.ts` `createAllowance`; `packages/demo/src/seed.ts` | live |
| `env::signer_account_pk` | telling the agent key from the owner's keys | `contracts/tally/src/pay.rs`, `capsule.rs` | live |
| `env::ed25519_verify` | merchant menu signatures, floor-fraud proofs | `pay.rs`, `dispute.rs` | live |
| `env::keccak256` | EIP-191 hash for portable receipts | `portable.rs` | live |
| NEP-141 | tUSDC balances, `ft_transfer_call` funding and family top-ups, `ft_transfer` payouts | `token.rs`, `contracts/tusdc` | live |
| Promises and callbacks | payout/withdraw settlement with rollback; MPC signature callback | `token.rs`, `portable.rs` | live |
| NEP-297 events | every state change (`paid`, `second_look`, `tripwire`, `receipt_signed`…) | `events.rs` | live |
| NEP-366 meta transactions | gasless agent payments through a relayer | `packages/sdk/src/relay.ts`, `web/app/api/relay` | live |
| Implicit accounts | passkey-derived owner accounts, no wallet needed | `web/lib/passkey.ts`, `web/app/api/onboard` | live |
| NEP-330 + reproducible builds | the deployed code hash matches a named commit | `contracts/tally/Cargo.toml` | live |

## NEAR ecosystem products

| Product | Used for | Code | Status |
| --- | --- | --- | --- |
| **Sputnik DAO** (`sputnikv2.testnet`) | the arbiter: council votes resolve disputes and blocklisting | `packages/demo/src/dao.ts` | live (`tally-arbiter.sputnikv2.testnet`) |
| **Chain Signatures** (`v1.signer-prod.testnet`) | MPC-signed receipts any EVM chain can `ecrecover` | `contracts/tally/src/portable.rs`, `packages/sdk/src/portable.ts` | live |
| **NEAR Intents** (1Click API) | live quotes and real deposit addresses for cross-chain top-ups (Base, Arbitrum, Ethereum, Polygon USDC → NEAR USDC) | `packages/sdk/src/intents.ts`, `web/app/api/intents`, `web/app/api/quote` | live API; a completed swap needs a real deposit |
| **NEAR AI Cloud** | private inference (planner) and TEE attestation (Intel TDX, verified with DCAP) | `packages/agent/src/planner.ts`, `attestation.ts`; `web/app/api/agent` | attestation live; model planning needs `NEAR_AI_API_KEY` |
| **NEAR AI Agent Market** | Tally Guard, a hireable worker agent delivering counterparty reports | `packages/agent/src/market.ts` | listed live |
| **HOT near-connect** | NEAR wallet sign-in (Meteor, Intear, Ledger, Nightly, EVM wallets) | `web/lib/wallet.ts` | live |
| FastNEAR / dRPC | RPC with failover | `packages/sdk/src/client.ts` | live |
| NearBlocks API | account age signal for the counterparty check; explorer links | `packages/sdk/src/guard.ts` | live |

## AI and agents

| Integration | Role | Code |
| --- | --- | --- |
| Context firewall | the model sees categories, prices, floors, dictionary words; never merchant prose | `packages/agent/src/firewall.ts`, `web/lib/firewall.ts` |
| Planner | NEAR AI Cloud model (OpenAI-compatible) when a key is set; deterministic cheapest-match otherwise; output validated | `packages/agent/src/planner.ts`, `web/app/api/agent` |
| MCP server | `tally_status`, `tally_menu`, `tally_check_merchant`, `tally_buy`, `tally_verify_tee`, `tally_quote_topup` | `packages/agent/src/mcp.ts` |
| CLI | `tally-buy "<goal>"` | `packages/agent/src/cli.ts` |

## Infrastructure

| Service | Used for |
| --- | --- |
| Cloudflare Workers (OpenNext) | the app and its API routes, one Worker, secrets via `wrangler secret` |
| GitHub Actions | CI: Rust unit tests, clippy, TypeScript tests, app build, dependency audits |
| Docker (`sourcescan/cargo-near`) | reproducible contract builds |
| Intel PCS | TDX collateral for DCAP verification |
