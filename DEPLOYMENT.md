# Deployment

## What is deployed

| Component | Where | Verified by |
| --- | --- | --- |
| Tally contract | [`tallynear.testnet`](https://testnet.nearblocks.io/address/tallynear.testnet) | code hash `EVP9Y5zkGVSV5juPCvwgqbM2XEdoZBY2LFDPUVba8k5e` = reproducible build of commit `2381dae` ([proofs §4](docs/proofs.md#4-verifiable-contract-reproducible-build--nep-330-source-metadata)) |
| tUSDC (NEP-141, 6 decimals) | [`tallynear-usdc.testnet`](https://testnet.nearblocks.io/address/tallynear-usdc.testnet) | `ft_metadata` |
| Arbiter DAO | [`tally-arbiter.sputnikv2.testnet`](https://testnet.nearblocks.io/address/tally-arbiter.sputnikv2.testnet) | `get_config.arbiter` |
| Sponsor / relayer | `tallynear-sponsor.testnet` | `/api/relay` responses name it |
| Demo merchants | `tallynear-cafe.testnet` (honest), `tallynear-shady.testnet` (blocklisted) | `assess` |
| App + API | https://tally-near.adoranto737.workers.dev (Cloudflare Workers, OpenNext) | HTTP 200 on `/`, `/counter`, `/api/counter` |
| Agent Market listing | `tally-guard` on `api.market.near.ai` | public agent and pricing-plan endpoints |

## Contract

```bash
PREFIX=yourname ./scripts/deploy.sh            # faucet accounts, build, deploy Tally + tUSDC (re-runnable)
PREFIX=yourname pnpm --filter @tally-near/demo seed
```

Verifiable release (clean, pushed tree; Docker):

```bash
cd contracts/tally && cargo near build reproducible-wasm
near contract deploy tallynear.testnet use-file ../../target/near/tally/tally.wasm without-init-call \
  network-config testnet sign-with-legacy-keychain send
```

State compatibility: features added after launch (Chain Signatures, in-flight and pending counters) keep
their data under their own storage prefixes, so redeploys need no migration.

## App (Cloudflare Workers)

```bash
cd web
cp .env.example .env.local                      # local dev
pnpm cf:deploy                                  # OpenNext build + wrangler deploy (wrangler.jsonc)
npx wrangler secret put SPONSOR_KEY             # plus SPONSOR_ACCOUNT, DEMO_MERCHANT_SIGNER_KEY
cp .env.local .dev.vars && pnpm cf:preview      # the Worker locally, in workerd
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `SPONSOR_ACCOUNT`, `SPONSOR_KEY` | yes | funds new accounts (`/api/onboard`) and pays relayed gas (`/api/relay`) |
| `DEMO_MERCHANT_SIGNER_KEY` | yes | signs the demo café's menu (`/api/counter`) |
| `NEAR_AI_API_KEY`, `NEAR_AI_MODEL` | no | model planning on NEAR AI Cloud; rules otherwise |
| `ONECLICK_JWT` | no | NEAR Intents partner key (0.2% fee without it) |
| `NEXT_PUBLIC_RPC_URL` | no | comma-separated RPC endpoints |

Contract and network ids for the app live in `web/lib/deployments.json`.

## CI

`.github/workflows/ci.yml`: Rust unit tests and clippy, TypeScript tests (SDK, agent, app), app build,
and dependency audits (`cargo audit`, `pnpm audit --prod`). Deployments are manual: they need keys that
never leave the maintainer's machine or Cloudflare's secret store.

## Mainnet checklist (not done)

* Point `config.token` at a real NEP-141 stablecoin; replace the faucet.
* Hand `set_config` admin to the DAO.
* Move rate limits and the sponsor budget to Durable Objects (SECURITY.md TAL-10).
* Independent audit.
