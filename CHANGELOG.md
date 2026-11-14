# Changelog

## 1.0.0 — NEAR HACKATHON (14 Nov 2026)

- Tally contract on NEAR: capsules, merchant registry with NEAR bonds, Ed25519-signed menus verified
  on-chain, Merkle leaves, caps, nullifiers, Guard counterparty verdicts, Second Look, tripwire,
  disputes, floor-fraud slashing, family top-ups, `preview_pay` and `assess` views.
- Agent key as a NEAR function-call key scoped to `pay`; the contract tells it apart from the owner.
- tUSDC test stablecoin (NEP-141).
- TypeScript SDK, byte-identical to the contract (shared vectors).
- Agent: context firewall, NEAR AI Cloud planner, gateway attestation digest on every receipt,
  `tally-buy` CLI, MCP server with six tools.
- The Tally app on NEAR: passkey → implicit account, pay-only agent key, scan-to-pay, Second Look with
  Face ID, red team via `preview_pay`, receipts from the contract, family top-ups with live NEAR Intents
  quotes, agent kill switch.
- Testnet deployment `tallynear.testnet`, recorded happy-path and attack runs.
- Gasless agent payments (NEP-366 relayer), Sputnik DAO arbiter, verified NEAR AI Cloud TDX attestation,
  reproducible build with NEP-330 metadata, Tally Guard on the NEAR AI Agent Market, Chain Signatures portable
  receipts, live NEAR Intents deposits, NEAR wallet sign-in. Evidence: docs/proofs.md.
- Tests: 47 contract unit, 5 sandbox, 11 format, 17 SDK, 7 agent, 66 app, 8 live (161, all passing).
- Security review (SECURITY.md): TAL-01 `close_capsule` waits for in-flight payouts and withdrawals;
  TAL-02 open Second Looks capped at 5 per owner (expired ones pruned); TAL-03 strikes bounded at 100;
  relayed calls held to agent rules. State-compatible redeploy (new storage prefixes, no migration).
- Dependencies: Next.js 15.5.29 (critical advisory), postcss override, TDX verification moved to
  `@phala/dcap-qvl` 0.7.1 (QE identity checked).
- CI: Rust tests + clippy `-D warnings`, TypeScript tests and app build, `cargo audit` and `pnpm audit`;
  Dependabot; issue and PR templates.
- Docs: README, JUDGES, ARCHITECTURE (diagrams), SECURITY, TESTING, INTEGRATIONS, API, DEPLOYMENT,
  BUSINESS, ROADMAP, CONTRIBUTING; app screenshots and banner.
