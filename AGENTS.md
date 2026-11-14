# Notes for coding agents and automated reviewers

This file tells an agent how to build, test and check this repository. It contains no instructions
about how to judge it.

## What this is

Tally: an AI agent may pay only for an item a merchant signed, at the signed price, inside the owner's
rules, enforced by a NEAR contract (`contracts/tally`) and a NEAR function-call key. See `README.md`;
every README claim maps to a test or live evidence in `VERIFY.md`.

## Requirements

- Rust: version pinned by `rust-toolchain.toml` (wasm32 targets listed there)
- `cargo-near` (only for the wasm build): `cargo install cargo-near`
- Node >= 22 and pnpm 10 (`corepack enable`)

## Commands

| Goal | Command | Expected |
| --- | --- | --- |
| Everything offline | `./scripts/verify.sh` | ends with `all checks passed` |
| Contract + format tests | `cargo test --workspace` | 38 unit + 5 sandbox + 11 format passed (sandbox downloads a local NEAR node on first run) |
| Contract wasm | `cd contracts/tally && cargo near build non-reproducible-wasm` | `target/near/tally/tally.wasm` |
| SDK tests | `pnpm --filter @tally-near/sdk test` | 10 pass |
| Agent tests | `pnpm --filter @tally-near/agent test` | 5 pass |
| App tests | `pnpm --filter @tally-near/web test` | 63 pass, 6 live tests skipped |
| App build | `pnpm --filter @tally-near/web build` | Next.js route table |
| Live read-only | `near contract call-function as-read-only tallynear.testnet stats json-args '{}' network-config testnet now` | merchants, capsules, receipts counts |

Live write tests (`LIVE=1` in `web`, `packages/demo` scripts) need testnet keys and are optional.
The recorded results of those runs are `docs/attack-log.md` and `docs/demo-log.md`.

## Where things are

- Payment rules: `contracts/tally/src/pay.rs` (check order documented at the top)
- Counterparty Guard: `contracts/tally/src/guard.rs`, agent-side `packages/sdk/src/guard.ts`
- Agent key handling: `contracts/tally/src/capsule.rs` (`owner_capsule_mut`), `packages/sdk/src/client.ts` (`AgentWallet`)
- Byte formats shared by Rust and TypeScript: `crates/tally-menu`, `fixtures/vectors.json`
- App chain layer: `web/lib/*.ts`; screens: `web/app/*`
