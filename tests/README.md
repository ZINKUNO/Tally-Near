# Tests

Tests live next to the code they test (the convention of each toolchain). This folder indexes them.
Results and coverage areas: [../TESTING.md](../TESTING.md).

| Suite | Location |
| --- | --- |
| Contract unit tests | [`contracts/tally/src/tests.rs`](../contracts/tally/src/tests.rs) |
| Contract integration (local NEAR node) | [`contracts/tally/tests/sandbox.rs`](../contracts/tally/tests/sandbox.rs) |
| Byte formats | [`crates/tally-menu/src`](../crates/tally-menu/src) (`#[cfg(test)]` in each module) |
| Cross-language vectors | [`fixtures/vectors.json`](../fixtures/vectors.json), [`fixtures/portable-receipt.json`](../fixtures/portable-receipt.json) |
| SDK | [`packages/sdk/test`](../packages/sdk/test) |
| Agent | [`packages/agent/test`](../packages/agent/test) |
| App unit tests | [`web/test`](../web/test) |
| Live end-to-end (testnet) | [`web/test/e2e.live.test.ts`](../web/test/e2e.live.test.ts) |
| Recorded adversarial run | [`docs/attack-log.md`](../docs/attack-log.md) |

Run all: `./scripts/verify.sh` from the repository root.
