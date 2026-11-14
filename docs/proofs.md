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
