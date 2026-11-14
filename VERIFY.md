# Verify every claim

Each claim in the README, with the test that proves it offline and, where it applies, the live
testnet evidence. Run everything offline with `./scripts/verify.sh` (no keys, no network beyond
package downloads). Contract tests are in `contracts/tally/src/tests.rs` and run with real Ed25519
signatures over the real header bytes.

| # | Claim | Offline test | Live evidence (testnet) |
| --- | --- | --- | --- |
| 1 | The agent pays the cheapest signed item on its own | `agent_pays_cheapest_signed_item_autonomously` | [demo-log.md](docs/demo-log.md) step 1 |
| 2 | A changed price is not on the menu | `tampered_price_is_not_on_menu` | [attack-log.md](docs/attack-log.md) step 3 |
| 3 | A menu signed by any other key is refused | `menu_signed_by_another_key_is_refused` | `/redteam` "Fake counter"; `web/test/e2e.live.test.ts` |
| 4 | A signature can't be replayed on another Tally deployment | `signature_for_another_deployment_does_not_replay` | — |
| 5 | A signature can't be reused for another merchant | `signature_for_another_merchant_does_not_transfer`, web `verify.test.ts` | — |
| 6 | Stale menus are refused; long menus need opt-in and the owner | `expired_menu_is_stale`, `long_menu_window_needs_opt_in_and_owner` | — |
| 7 | Category, per-purchase and daily caps are enforced, rolling 24 h | `category_and_caps_are_enforced`, `daily_cap_rolls_over_after_24h` | attack-log step 4 |
| 8 | The same menu item can't be paid twice | `same_menu_item_cannot_be_paid_twice` | — |
| 9 | A pricier pick waits for the owner (Second Look), then pays co-signed | `pricier_pick_waits_for_owner_then_pays_on_approve` | demo-log steps 2–3; e2e "pricier pick" |
| 10 | Second Looks expire, and can be declined | `second_look_expires`, `declined_second_look_is_gone` | — |
| 11 | The agent key can't approve, loosen rules or unfreeze, even if issued wider | `agent_key_cannot_approve_its_own_second_look`, `agent_key_cannot_loosen_rules`, `agent_key_cannot_unfreeze` | — |
| 12 | The agent key can't send NEAR, call other methods, or call other contracts | NEAR protocol (function-call key) | attack-log steps 6, 7, 8 with the protocol's error names |
| 13 | No other contract can call `pay` for an owner | `another_contract_cannot_pay_from_a_capsule` | — |
| 14 | Three rejected agent attempts in an hour freeze the capsule | `tripwire_freezes_after_three_rejected_attempts`, `strikes_older_than_an_hour_do_not_count` | attack-log steps 2–5 |
| 15 | Rule violations by the owner panic; by the agent they are recorded | `owner_signed_violation_panics_instead_of_striking`, `owner_can_pay_pricier_item_directly` | — |
| 16 | Guard blocks blocklisted / unknown merchants even with a valid menu | `blocklisted_merchant_is_blocked_even_with_a_valid_menu`, `unknown_merchant_is_rejected` | attack-log step 2 |
| 17 | Guard warns on new merchants, changed payouts, reports | `new_merchant_draws_a_guard_warning`, `changed_payout_draws_a_guard_warning`, `two_owner_reports_make_the_guard_warn` | `pnpm --filter @tally-near/demo status` |
| 18 | Agent-side wrapper refuses on block, asks a human on warn, pins contract code hashes | `packages/sdk/test/guard.test.ts` (6 tests) | attack-log step 1 |
| 19 | A bounced payout refunds the capsule and frees the nullifier | `failed_payout_refunds_the_capsule_and_frees_the_nullifier` | — |
| 20 | `preview_pay` answers exactly what `pay` would, without state changes | `preview_matches_pay` | `/redteam`; e2e "red-team attacks" |
| 21 | Floor fraud slashes the bond to the reporter and blocklists the merchant | `floor_fraud_slashes_bond_and_blocklists_merchant`, `honest_menu_cannot_be_called_fraud` | — |
| 22 | Rotated keys stop paying but stay slashable | `rotated_key_stops_paying_but_stays_slashable` | — |
| 23 | Upheld disputes slash the bond to the owner; bonds can't leave while disputed | `upheld_dispute_slashes_bond_to_the_owner`, `bond_cannot_leave_while_disputed` | — |
| 24 | Family can top up someone else's allowance, with a note | `family_can_top_up_someone_elses_capsule` | e2e "family tops up" |
| 25 | TypeScript and Rust produce identical bytes | `packages/sdk/test/menu.test.ts`, `web/test/menu.test.ts` vs `fixtures/vectors.json` | — |
| 26 | The model never sees merchant text | `packages/agent/test/agent.test.ts`, `web/test/firewall.test.ts` | attack-log step 1 shows the injected note |
| 27 | Model output outside the menu falls back to rules | `model planner: valid answer is used, out-of-range answer falls back to rules` | — |
| 28 | Receipts carry a NEAR AI Cloud attestation digest bound to a fresh nonce | `attestation requires the nonce to be echoed` | `get_receipt` → `attestation: "nearai-gw:…"` |
| 29 | One passkey derives the owner implicit account, agent and menu keys | `web/test/passkey.test.ts` | e2e "a new Face ID user…" |
| 30 | The MCP server exposes status, menu, merchant check and buy | `pnpm --filter @tally-near/agent mcp:smoke` (needs the merchant server) | — |

## Live, read-only (no keys)

```bash
near contract call-function as-read-only tallynear.testnet stats json-args '{}' network-config testnet now
near contract call-function as-read-only tallynear.testnet get_capsule json-args '{"owner":"tallynear-alice.testnet"}' network-config testnet now
near contract call-function as-read-only tallynear.testnet assess json-args '{"merchant_id":"tallynear-shady.testnet"}' network-config testnet now
near contract call-function as-read-only tallynear.testnet get_receipts json-args '{"owner":"tallynear-alice.testnet"}' network-config testnet now
```

Expected: `assess` on the shady shop returns `"level": "block"` with the blocklist reason;
`get_capsule` shows the attempts the attack run recorded; receipts show `settled`, `cosigned`, and an
`attestation` digest.
