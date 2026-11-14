# @tally-near/agent

The shopping agent: verifies the menu, runs the counterparty check, plans behind a context firewall,
pins NEAR AI Cloud attestation, previews, then pays with the function-call key.

```bash
# one purchase (menu from the demo merchant server: pnpm --filter @tally-near/demo merchant)
pnpm buy "a coffee"
pnpm buy "a croissant" --menu http://localhost:8787/menu/cafe --yes

# MCP server over stdio
pnpm mcp
pnpm mcp:smoke      # lists tools and calls the read-only ones
```

| Env | Meaning |
| --- | --- |
| `TALLY_CONTRACT` | default `tallynear.testnet` |
| `TALLY_OWNER` | capsule owner account |
| `TALLY_AGENT_KEY` | the function-call key (`ed25519:…`); defaults to the demo key file |
| `TALLY_MENU_BASE` | merchant menu server, default `http://localhost:8787` |
| `NEAR_AI_API_KEY` | optional: plan with a NEAR AI Cloud model; otherwise cheapest-match rule |
| `NEAR_AI_MODEL` | default `zai-org/GLM-5.1-FP8` |
| `TALLY_MIN_ACCOUNT_AGE_MS` | payout accounts younger than this draw a warning (default 24 h) |

MCP tools: `tally_status`, `tally_menu`, `tally_check_merchant`, `tally_buy`, `tally_quote_topup` (live NEAR Intents price, dry). None of them can approve
a Second Look, change rules or unfreeze: the key they hold can't.

Also: `pnpm verify-tee` (Intel DCAP check of NEAR AI Cloud), `pnpm market …` (Tally Guard on the Agent Market),
`TALLY_RELAY_URL=…/api/relay` for gasless payments.

Tests: `pnpm test` (7).
