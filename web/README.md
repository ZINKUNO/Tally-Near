# Tally app

The phone-first Tally app (Next.js). One Face ID passkey derives three NEAR keys: the owner's
implicit account, the agent's pay-only function-call key, and a café's menu signing key.

Live: https://tally-near.adoranto737.workers.dev (Cloudflare Workers via OpenNext).

```bash
cp .env.example .env.local   # fill in the sponsor and demo-counter secrets
pnpm dev                     # http://localhost:3000
pnpm test                    # 66 unit tests
LIVE=1 pnpm test             # + live testnet end to end (needs .env.local)
```

| Route | What it does |
| --- | --- |
| `/` | Sign up / sign in with a passkey |
| `/allowance` | Open an allowance: rules, first deposit, the agent's pay-only key |
| `/home` | Balance, today's spend, pause, ask family to top up |
| `/scan` | Scan a counter's QR, the agent proposes, the contract decides |
| `/counter` | The demo café's live, re-signed menu QR |
| `/merchant` | Open your own counter (0.2 NEAR bond) and see sales |
| `/redteam` | Four attacks against the live menu, judged by `preview_pay` |
| `/receipts` | On-chain receipts, family top-ups, blocked attempts |
| `/send/<account>` | Family top-up link |
| `/api/onboard` | Sponsor funds a new implicit account (NEAR + test USD) |
| `/api/counter` | Freshly signed demo menu |
| `/api/quote` | Dry NEAR Intents quote for a cross-chain top-up |
| `/api/agent` | NEAR AI Cloud pick behind the context firewall, rule fallback |

## Deploy to Cloudflare

The whole app (pages and `/api` routes) runs as one Worker through `@opennextjs/cloudflare`.

```bash
pnpm cf:deploy                              # build with OpenNext and deploy (wrangler.jsonc)
npx wrangler secret put SPONSOR_KEY         # plus DEMO_MERCHANT_SIGNER_KEY, SPONSOR_ACCOUNT
cp .env.local .dev.vars && pnpm cf:preview  # the Worker locally, in workerd
```
