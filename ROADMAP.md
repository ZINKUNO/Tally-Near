# Roadmap

## Done (NEAR HACKATHON, Nov 2026)

* Tally contract on testnet with signed menus, rules, Guard, Second Look, tripwire, disputes, floor-fraud
  slashing, family top-ups, Chain Signatures receipts; internal security review with fixes.
* Gasless agent payments (NEP-366), Sputnik DAO arbiter, verified NEAR AI Cloud attestation, reproducible
  build, Agent Market listing, NEAR Intents deposits, passkey and wallet sign-in.
* App on Cloudflare, SDK, agent CLI, MCP server.

## Next (weeks)

* Complete end-to-end runs that need real funds: a NEAR Intents swap into an allowance; a paid Agent Market hire.
* Global rate limits and sponsor budget (Durable Objects).
* Full DCAP verification inside the app (the pure-JS verifier makes a Worker-side check possible).
* Merchant dashboard: menu editor, sales export, dispute handling.

## Later (months)

* Mainnet: real stablecoin, DAO-held admin, independent audit.
* Settle merchant payouts on other chains with Chain Signatures (today receipts are signed, not payouts).
* Indexer for history at scale; notification service for Second Looks.
* Pilot in one closed loop (canteen or café).
