# Proofs

Live evidence for each NEAR integration, on testnet unless noted. Every link opens the transaction or
account on NearBlocks. Reproduce with the command in each section.

## 1. Gasless agent payments (NEP-366 meta transactions)

The agent signs `pay` as a delegate action with its function-call key; the app's relayer
(`/api/relay` on the Cloudflare Worker, account `tallynear-sponsor.testnet`) wraps it and pays the gas.
The contract holds every relayed `pay` to the agent's rules (no co-sign, strikes count, refused once
the agent is revoked) and refuses to relay owner actions.

| What | Evidence |
| --- | --- |
| CLI agent buys a croissant through the live relayer, receipt #23 | [8mN5iNz8…](https://testnet.nearblocks.io/txns/8mN5iNz8jfJq6jPV4ET1FSEc9PLRiqbVunJos8CnmBo7) |
| Owner's NEAR balance unchanged after a gasless pay | `web/test/e2e.live.test.ts` "gasless…" |
| Relayed pay never counts as the owner; revoked agent can't be relayed; `approve` can't be relayed | `relayed_pay_is_held_to_agent_rules`, `relayed_pay_refused_after_the_agent_is_revoked`, `owner_actions_cannot_be_relayed` |
| Relayer sponsors only `pay` on Tally (no other receiver, method, deposit or batch) | `packages/sdk/test/relay.test.ts` |

Reproduce: `TALLY_RELAY_URL=https://tally-near.adoranto737.workers.dev/api/relay pnpm --filter @tally-near/agent buy "a croissant"`

## 2. Sputnik DAO is the arbiter

Tally's `arbiter` is [`tally-arbiter.sputnikv2.testnet`](https://testnet.nearblocks.io/address/tally-arbiter.sputnikv2.testnet),
a Sputnik DAO whose council votes on disputes. No single key can slash a merchant's bond or blocklist it.

| Step | Transaction |
| --- | --- |
| DAO created (council: `tallynear-arbiter`, `tallynear-bob`) | [GeBmDh7j…](https://testnet.nearblocks.io/txns/GeBmDh7jcdyQgxto7skKu4iJ66DwxMf8QcvVqDVUDoTT) |
| Tally's arbiter set to the DAO | [7BXxQs6M…](https://testnet.nearblocks.io/txns/7BXxQs6MSwu3aiLmX3tjFyX66CbY7c5SBgaY645SPmst) |
| Alice disputes receipt #23 with an evidence hash | [59Tg9DH4…](https://testnet.nearblocks.io/txns/59Tg9DH4Pzig6o1AxwoHHgXQHKfLsSFGedKbtL2WvwTc) |
| Proposal #0: `resolve_dispute(23, upheld, 0.05 NEAR)` | [HYFnRUZp…](https://testnet.nearblocks.io/txns/HYFnRUZpPFwognnjy8ps6sLE6BgxHAk3fZ8xdBDqZEkW) |
| Vote 1 | [EzfWAAe3…](https://testnet.nearblocks.io/txns/EzfWAAe3MosqMFZMQa13quJdNGkmv3ykHQsoLLrE7j28) |
| Vote 2: approved, the DAO executes, 0.05 NEAR of the bond pays alice | [HCvd6fX6…](https://testnet.nearblocks.io/txns/HCvd6fX6dofYaEEQAkE1NptqUJRQheYnRziWMsGYJckZ) |

Check: `near contract call-function as-read-only tallynear.testnet get_dispute json-args '{"receipt_id":23}' network-config testnet now` → `"status": "upheld"`.
Reproduce: `pnpm --filter @tally-near/demo dao`.

## 3. NEAR AI Cloud TEE, verified (Intel TDX)

Before each purchase the agent fetches the NEAR AI Cloud gateway's Intel TDX quote bound to a fresh
32-byte nonce and verifies it the same way as [nearai-cloud-verifier](https://github.com/nearai/nearai-cloud-verifier):
Intel DCAP collateral check, then `report_data[0..32]` = gateway signing key and `report_data[32..64]` = our nonce,
read from the verified quote. Verified purchases carry `nearai-tdx:<status>:<quote>:<nonce>` in the on-chain receipt.

```text
$ pnpm --filter @tally-near/agent verify-tee
nonce            0eb8857ff72f3f16393a02b945c10b36011b170a4e83d1cb06d3d5362d6d1364
signing address  40599fb284f43953bb356b09080fd803c960fc10285ad90eca462ca711ad4acb
quote sha256     6375bb4aeeb793bd4d6c99fe05284f57e6b433a4689c1fdf861c4fac5f6a7d1e
Intel DCAP       UpToDate
binds address    true
binds our nonce  true
VERIFIED         true   receipt label: nearai-tdx:UpToDate:6375bb4aeeb793bd:0eb8857ff72f3f16
```

On-chain: receipt #24 ([AErn655d…](https://testnet.nearblocks.io/txns/AErn655dXAbarCWjziM42EmAAEdrvT6Fovdt7PHE9XKu), paid gaslessly) carries
`"attestation": "nearai-tdx:UpToDate:a83e6dbd72fea983:5064da35e9053215"`.

Also: MCP tool `tally_verify_tee`; tests `a verified quote must bind the signing address and our nonce`.
Scope: the app on Cloudflare records the nonce-bound quote digest (`nearai-gw:`); the full DCAP check runs in the agent
(Node), because the verifier's WebAssembly build loads from disk.

## 4. Verifiable contract: reproducible build + NEP-330 source metadata

The deployed contract is built in the pinned Docker image `sourcescan/cargo-near:0.22.0-rust-1.97.1` from a
committed revision of this repo, and embeds NEP-330 metadata naming that revision. Anyone can rebuild it
and compare hashes.

| Check | Value |
| --- | --- |
| Reproducible build of commit [`3ef9d93`](https://github.com/ZINKUNO/Tally-Near/tree/3ef9d9353afef1bea90f122ba0560851ac465a2a) | SHA-256 bs58 `6HcRTRu6sL2VuEsfqTQTu9UArgtQnmChxNMokXcxSjx3` |
| On-chain `code_hash` of `tallynear.testnet` | `6HcRTRu6sL2VuEsfqTQTu9UArgtQnmChxNMokXcxSjx3` (same) |
| Deploy transaction | [6qexWrYU…](https://testnet.nearblocks.io/txns/6qexWrYUjvRDgThaVSSdKgkamCH2BcraKu6uTwjQrr5g) |
| `contract_source_metadata` (NEP-330 1.3.0) | `source_code_snapshot: git+https://github.com/ZINKUNO/Tally-Near?rev=3ef9d93…` |

Reproduce:
```bash
git checkout 3ef9d9353afef1bea90f122ba0560851ac465a2a
cd contracts/tally && cargo near build reproducible-wasm     # prints the SHA-256 bs58 above
near contract call-function as-read-only tallynear.testnet contract_source_metadata json-args '{}' network-config testnet now
```
