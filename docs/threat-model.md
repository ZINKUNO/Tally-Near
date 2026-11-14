# Threat model

Who can try to move the owner's money, what they control, and what stops them. Each row points at
the code and the test that prove it.

| Attacker | Controls | Tries | Stopped by | Proof |
| --- | --- | --- | --- | --- |
| Prompt-injected model | the agent's choice | pay a fake "refund fee" from menu text | context firewall: the model never sees merchant text; Guard blocks the shop | `packages/agent/test`, attack-log step 1 |
| Hijacked agent process | the agent key | sign `pay` with a lower price | contract hashes the leaf itself; not on the signed menu | `tampered_price_is_not_on_menu` |
| Hijacked agent process | the agent key | buy outside the rules, again and again | caps + categories; the tripwire freezes after 3 rejections | `tripwire_freezes_after_three_rejected_attempts`, sandbox |
| Hijacked agent process | the agent key | send NEAR, call `update_rules`/`approve`/`unfreeze`, call the token | NEAR function-call key scope; contract refuses owner methods from the agent key | sandbox `the_protocol_refuses_everything_else_the_agent_key_tries`, attack-log 6–8 |
| Hijacked agent process | the agent key | approve its own Second Look | `approve` refuses the agent key | `agent_key_cannot_approve_its_own_second_look` |
| Fake counter | a QR code | a look-alike menu signed by its own key | signature checked against the registered key | `menu_signed_by_another_key_is_refused` |
| Replay | an old signed menu | pay it later, or twice, or on another deployment | 60 s–10 min window; nullifier; header binds the contract id | `expired_menu_is_stale`, `same_menu_item_cannot_be_paid_twice`, `signature_for_another_deployment_does_not_replay` |
| Dishonest merchant | its menu key | sign a menu whose "cheapest" isn't, to upsell agents | anyone proves the contradiction; half the bond slashed, merchant blocklisted | `floor_fraud_slashes_bond_and_blocklists_merchant` |
| Compromised merchant account | the merchant account | redirect sales with `set_payout`, or swap the menu key | Guard warns for the configured window, so purchases need the owner | `changed_payout_draws_a_guard_warning` |
| Merchant that cheats after a sale | the goods | not deliver | owner disputes; arbiter slashes the bond to the owner; bond locked while disputed | `upheld_dispute_slashes_bond_to_the_owner`, `bond_cannot_leave_while_disputed` |
| Malicious contract | a call path | call `pay` on the owner's behalf | `signer == predecessor` required | `another_contract_cannot_pay_from_a_capsule` |
| Wrong or fake token | an NEP-141 contract | fund a capsule with junk | only the configured token credits capsules; others are returned | `other_tokens_are_returned` |
| Unlucky payout | the token | a payout that bounces | callback refunds the capsule, restores the cap, frees the nullifier | `failed_payout_refunds_the_capsule_and_frees_the_nullifier`, sandbox |

## Out of scope

* A stolen **owner** key (or unlocked phone): it can change rules and approve. The passkey requires
  user verification on every unlock; revoking the agent and freezing are one tap each.
* A malicious **arbiter**: it can rule disputes and edit the blocklist. Point `arbiter` at a Sputnik DAO
  to spread that trust.
* The model's choice among *valid* options: the owner's rules decide what is allowed; Second Look
  catches anything above the cheapest match.
* Attestation: receipts pin a NEAR AI Cloud gateway quote digest bound to a nonce; full DCAP
  verification is left to the owner's verifier.
