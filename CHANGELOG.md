# Changelog

## 1.0.0 — NEAR HACKATHON (14 Nov 2026)

- Tally contract on NEAR: capsules, merchant registry with NEAR bonds, Ed25519-signed menus verified
  on-chain, Merkle leaves, caps, nullifiers, Guard counterparty verdicts, Second Look, tripwire,
  disputes, floor-fraud slashing, family top-ups, `preview_pay` and `assess` views.
- Agent key as a NEAR function-call key scoped to `pay`; the contract tells it apart from the owner.
- tUSDC test stablecoin (NEP-141).
- TypeScript SDK, byte-identical to the contract (shared vectors).
- Agent: context firewall, NEAR AI Cloud planner, gateway attestation digest on every receipt,
  `tally-buy` CLI, MCP server with five tools.
- The Tally app on NEAR: passkey → implicit account, pay-only agent key, scan-to-pay, Second Look with
  Face ID, red team via `preview_pay`, receipts from the contract, family top-ups with live NEAR Intents
  quotes, agent kill switch.
- Testnet deployment `tallynear.testnet`, recorded happy-path and attack runs.
- Tests: 38 contract unit, 5 sandbox, 11 format, 10 SDK, 5 agent, 63 app, 6 live.
