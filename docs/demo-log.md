# Tally happy path — 2026-11-14T13:24:08Z

Run with `pnpm --filter @tally-near/demo pay` against `tallynear.testnet`.

```text

1. "get me a coffee"
  ✔ menu                 signature matches tallynear-cafe.testnet's registered key, 6 items
  ✔ check:onchain_guard  allow: no on-chain red flags
  ✔ check:payout_kind    allow: tallynear-cafe.testnet is a plain account
  ✔ check:payout_age     allow: payout account is 91 minutes old
  ✔ check:history        allow: first purchase from this merchant
  ✔ plan                 rules: item #0 (coffee, 4.50) — cheapest coffee on the signed menu
  ✔ attest               NEAR AI Cloud gateway quote 6d2308421dee1e16… bound to nonce 372fec96…
  ✔ preview              contract would answer paid
  ✔ pay                  paid — receipt #2
  => PAID Flat white (small) 4.5 tUSDC
     https://testnet.nearblocks.io/txns/J8Jyz5YhDy3FdyaeFek8ViExsKE13K5mgjj93yXHsoJE

2. "a large flat white" (the agent picks a pricier coffee)
  ✔ menu                 signature matches tallynear-cafe.testnet's registered key, 6 items
  ✔ check:onchain_guard  allow: no on-chain red flags
  ✔ check:payout_kind    allow: tallynear-cafe.testnet is a plain account
  ✔ check:payout_age     allow: payout account is 91 minutes old
  ✔ check:history        allow: 1 earlier settled purchase(s) here
  ✔ plan                 given: item #1 (coffee, 5.90) — the owner asked for the large one
  ✔ attest               NEAR AI Cloud gateway quote e549d2e83ff6b810… bound to nonce 9ef650af…
  ✔ preview              contract would answer second_look: not the cheapest in category 3 (floor 4500000)
  ✔ pay                  second_look — parked for the owner (pending #1): not the cheapest in category 3 (floor 4500000)
  => SECOND_LOOK Flat white (large) 5.9 tUSDC
     https://testnet.nearblocks.io/txns/H6nVRwtDYqSgduCijDwsg7unVxvQTVDMbDTG9doBwdpm

3. Owner taps "Approve" (full-access key)
  => PAID, co-signed
     https://testnet.nearblocks.io/txns/ExbZSKLPnqWZ4KaQQ8NXjyNYrZYnAiU37MSmnjikh7k3

Capsule: 89.6 tUSDC left, 14.6 tUSDC headroom today
```
