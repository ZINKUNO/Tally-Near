# @tally-near/demo

Testnet scripts. Account names come from `PREFIX` (default `tallynear`); full-access keys from
`~/.near-credentials` (written by `scripts/deploy.sh`), demo keys from `~/.tally/<prefix>/keys.json`.

| Script | Does |
| --- | --- |
| `pnpm seed` | merchants with bonds, owner capsule, pay-only agent key, 100 tUSDC funding, reports, blocklist |
| `pnpm merchant` | menu server: `GET /menu/cafe`, `GET /menu/shady` (freshly signed each request) |
| `pnpm pay` | autonomous purchase, then a pricier pick → Second Look → owner approves |
| `pnpm attack` | the nine-step attack run; writes `docs/attack-log.md` |
| `pnpm status` | config, merchants with Guard verdicts, the owner's capsule and receipts |
