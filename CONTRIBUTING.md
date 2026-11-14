# Contributing

## Setup

Rust (pinned by `rust-toolchain.toml`), `cargo-near`, Node ≥ 22, pnpm 10.

```bash
pnpm install
./scripts/verify.sh        # everything offline; SANDBOX=1 adds the local NEAR node tests
```

## Ground rules

* **Every behaviour change ships with a test.** Contract rules in `contracts/tally/src/tests.rs`; anything that
  needs the real wasm or token in `contracts/tally/tests/sandbox.rs`.
* **Byte formats are shared.** If you touch `crates/tally-menu`, regenerate `fixtures/vectors.json`
  (`cargo run -p tally-menu --example vectors > fixtures/vectors.json`) and keep the SDK and app tests green.
* **Don't change stored structs** of a deployed contract; put new data under a new storage prefix
  (see `lib.rs` counters and `portable.rs`).
* **Never commit secrets.** Keys belong in `~/.near-credentials`, `~/.tally/`, `.env.local` or `wrangler secret`.
* **Claims need evidence.** If you add a feature to the README, add a row to `VERIFY.md`.

## Pull requests

Small, focused commits with conventional prefixes (`feat`, `fix`, `docs`, `test`, `chore`). CI must pass.
Security issues: see [SECURITY.md](SECURITY.md); please don't open a public issue with exploit details.
