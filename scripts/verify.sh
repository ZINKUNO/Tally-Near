#!/usr/bin/env bash
# One command a reviewer can run: every offline check, then (optionally) read-only checks against
# the live testnet deployment. Needs Rust (rust-toolchain.toml pins it), Node >= 22 and pnpm.
#   ./scripts/verify.sh          offline: format crate, contract, SDK, agent, app tests, wasm + app builds
#   LIVE=1 ./scripts/verify.sh   also reads the deployed contract on testnet (no keys needed)
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }

step "Rust: menu format crate + contract unit tests"
out=$(cargo test --workspace --quiet 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -E "test result: ok\. [1-9]"

step "Contract builds to wasm"
(cd contracts/tally && cargo near build non-reproducible-wasm >/dev/null 2>&1) && ls -la target/near/tally/tally.wasm | awk '{print $5" bytes  target/near/tally/tally.wasm"}'

step "TypeScript: SDK, agent and app tests"
pnpm install --frozen-lockfile --silent
pnpm --filter @tally-near/sdk test 2>&1 | grep -E "^# (pass|fail)"
pnpm --filter @tally-near/agent test 2>&1 | grep -E "^# (pass|fail)"
pnpm --filter @tally-near/web test 2>&1 | grep -E "Test Files|Tests "

step "App builds"
pnpm --filter @tally-near/web build >/dev/null && echo "next build ok"

if [ "${LIVE:-0}" = "1" ]; then
  step "Live testnet (read-only)"
  pnpm --filter @tally-near/demo status
fi
echo; echo "all checks passed"
