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
