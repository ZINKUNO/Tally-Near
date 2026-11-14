# Testing

Every claim in the README maps to a test or live evidence ([VERIFY.md](VERIFY.md)). This page lists the
suites, what they cover, how to run them, and the **actual results of the last run** (14 Nov 2026, on the
audited contract, commit `2381dae`, deployed code hash `EVP9Y5zk…`).

## Results

| Suite | Runner | Tests | Result |
| --- | --- | ---: | --- |
| Contract unit tests (real Ed25519 over real header bytes) | `cargo test -p tally --lib` | 47 | ✅ 47 passed |
| Menu byte formats (header, leaf, Merkle) | `cargo test -p tally-menu` | 11 | ✅ 11 passed |
| Contract on a local NEAR node (built wasm, real NEP-141, real function-call key) | `cargo test -p tally --test sandbox` | 5 | ✅ 5 passed |
| TypeScript SDK | `pnpm --filter @tally-near/sdk test` | 17 | ✅ 17 passed |
| Agent (firewall, planner, attestation, Agent Market) | `pnpm --filter @tally-near/agent test` | 7 | ✅ 7 passed |
| App (menus, passkeys, checkout, wallet, intents, firewall…) | `pnpm --filter @tally-near/web test` | 66 | ✅ 66 passed |
| Live end-to-end on NEAR testnet | `LIVE=1 npx vitest run test/e2e.live.test.ts` (in `web`) | 8 | ✅ 8 passed |
| Contract builds to wasm; app production build | `./scripts/verify.sh` | — | ✅ |
| Static analysis | `cargo clippy --target wasm32-unknown-unknown` | — | ✅ clean |

**161 automated tests**, plus recorded live runs: [attack log](docs/attack-log.md) (8 attacks, 0 units moved)
and [happy path](docs/demo-log.md). No coverage percentage is published because none is measured.

## What the contract tests cover

| Area | Examples |
| --- | --- |
| Normal execution | autonomous cheapest-match pay, settle callback, Second Look + approve, family top-up, sales view |
| Authorization | agent key can't approve, loosen rules or unfreeze; relayed calls held to agent rules; owner actions can't be relayed; other contracts can't pay from a capsule |
| Invalid input | tampered price, foreign signature, signature for another deployment or merchant, stale or over-long menus, bad hex |
| Business rules | categories, per-purchase cap, rolling 24 h cap, balance, expiry, nullifier, Guard warnings and blocks |
| State transitions & failures | bounced payout refunds and frees the nullifier; close waits for in-flight transfers; Second Look expiry and decline; tripwire freeze/unfreeze |
| Economic attacks | floor-fraud proof slashes and blocklists; honest menus can't be "proven" fraudulent; upheld disputes slash to the owner; bonds locked while disputed |
| DoS bounds | open Second Looks capped; strike list bounded (audit fixes TAL-01..03) |
| Chain Signatures | receipt digest binds every field; MPC answer parsed and stored; only settled receipts signed |

Reentrancy: NEAR has no synchronous re-entry; the async equivalent (state written before promises, restored
in callbacks) is covered by the callback tests above. Overflow: release builds use `overflow-checks = true`.

## Run everything

```bash
./scripts/verify.sh                 # offline: Rust, wasm, SDK, agent, app, build
SANDBOX=1 ./scripts/verify.sh       # + local NEAR node tests (downloads the node once)
LIVE=1 ./scripts/verify.sh          # + read-only checks against testnet
```

Live write tests (`web/test/e2e.live.test.ts`, `packages/demo` scripts) need testnet keys; see
[DEPLOYMENT.md](DEPLOYMENT.md).
