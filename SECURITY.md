# Security

Tally lets an AI agent spend money it doesn't control. Security is the product, so this document is
specific: what we protect, who we assume can attack, what we checked, what we found, what we fixed,
and what is still open.

> **Status.** Tally is a hackathon project deployed on **NEAR testnet** only. It has had an **internal
> security review** (manual code review, automated tooling and adversarial tests by the author during
> NEAR HACKATHON, November 2026). It has **not** had an independent third-party audit. Do not use it
> with real funds.

## Reporting a vulnerability

Open a GitHub issue titled `security` **without** exploit details and we will reply with a private
channel. Please do not publish details until a fix is deployed.

## Assets

| Asset | Where it lives | Who may move it |
| --- | --- | --- |
| Capsule balances (tUSDC) | `tallynear.testnet` | the agent, only through `pay` and only inside the owner's rules; the owner via `withdraw` |
| Merchant bonds (NEAR) | `tallynear.testnet` | the merchant after an unlock delay with no open disputes; the arbiter (Sputnik DAO) on an upheld dispute; anyone who proves floor fraud (50%) |
| Owner rules, agent key binding | capsule state | the owner, signing directly (never the agent key, never relayed) |
| Sponsor and relayer NEAR | `tallynear-sponsor.testnet` | the Cloudflare Worker (`/api/onboard`, `/api/relay`) |
| Owner keys | derived on the phone from a passkey (PRF); never stored | the owner's authenticator |

## Trust assumptions

* NEAR protocol enforces function-call access keys (receiver, method names, no deposit, allowance) and
  NEP-366 delegate signatures.
* The NEP-141 token at `config.token` behaves to standard (`ft_transfer`, `ft_transfer_call`).
* The arbiter account is honest-majority (it is a Sputnik DAO council).
* NEAR's MPC network (`v1.signer-prod.testnet`) signs only what the calling contract asks for.
* Merchants keep their menu signing key private; a leaked key lets an attacker sign *that merchant's*
  menus only, payable only to *that merchant's* registered payout.
* The model choosing purchases is **untrusted**. Everything it outputs is checked by code and the contract.

## Attack surfaces

1. `pay` (agent key, owner key, or relayed meta transaction).
2. Owner methods (`update_rules`, `approve`, `unfreeze`, `withdraw`, `set_agent_key`, `close_capsule`).
3. Token callbacks (`ft_on_transfer`, `on_payout`, `on_withdraw`).
4. Merchant methods, disputes, floor-fraud proofs, reports, blocklist.
5. Chain Signatures (`sign_receipt`, `on_receipt_signed`).
6. The Worker API: `/api/relay`, `/api/onboard`, `/api/agent`, `/api/counter`, `/api/quote`, `/api/intents`.
7. The agent: menus from untrusted merchants, model output, NEAR AI Cloud attestation.

The full attacker-by-attacker table is in [docs/threat-model.md](docs/threat-model.md).

## Methodology

| Kind | What was done | Tool / evidence |
| --- | --- | --- |
| Manual code review | Every contract method, callback and storage path reviewed for access control, async state, arithmetic, replay and storage DoS | this document |
| Unit tests (contract) | 47 tests with real Ed25519 signatures over real header bytes, covering every `pay` check, owner/agent separation, relayed calls, callbacks, disputes, fraud proofs, Chain Signatures handling | `contracts/tally/src/tests.rs` |
| Integration tests | 5 tests running the built wasm, a real NEP-141 token and a real function-call key on a local NEAR node | `contracts/tally/tests/sandbox.rs` |
| Live adversarial run | A prompt-injected agent tries 8 ways to move money on testnet; every attempt recorded with its transaction | [docs/attack-log.md](docs/attack-log.md) |
| Static analysis | `cargo clippy --target wasm32-unknown-unknown` on all three crates: clean | CI |
| Dependency audit | `cargo audit`, `pnpm audit --prod` | results below |
| Verifiable build | The deployed code hash equals a reproducible Docker build of a named commit | [docs/proofs.md §4](docs/proofs.md#4-verifiable-contract-reproducible-build--nep-330-source-metadata) |

## Findings

Severity follows impact × likelihood on the deployed design. "Fixed" means the fix is merged, tested and
deployed to `tallynear.testnet` (code hash `EVP9Y5zk…`, commit `2381dae`).

| ID | Severity | Finding | Affected | Status |
| --- | --- | --- | --- | --- |
| TAL-01 | Medium | `close_capsule` could run while a payout or withdrawal was still in flight. If that `ft_transfer` then bounced, the refund callback found no capsule and the tokens were stranded in the contract. | `capsule.rs` `close_capsule`, `token.rs` callbacks | **Fixed**: an in-flight counter per owner (own storage prefix, no migration); close refuses until it is zero. Test `close_capsule_waits_for_payouts_in_flight`. |
| TAL-02 | Medium | Unbounded Second Looks: a compromised agent (gas paid by the relayer) could create pending purchases without limit, each stored at the contract's expense: a storage-staking drain. | `pay.rs` | **Fixed**: at most 5 open Second Looks per owner; expired ones are pruned when the cap is hit; extra attempts are rejected as `too_many_pending` and count as strikes. Autonomous (cheapest-match) payments are unaffected. Tests `open_second_looks_are_capped_but_autonomous_pay_is_not`, `expired_second_looks_stop_counting_toward_the_cap`. |
| TAL-03 | Low | With the tripwire disabled, the strike list grew with every rejected attempt for an hour (storage growth per capsule). | `pay.rs` `record_strike` | **Fixed**: capped at 100 entries. Test `strikes_stay_bounded_with_the_tripwire_off`. |
| TAL-04 | Medium (design) | Relayed `pay` (NEP-366) arrives with the **relayer** as `signer_account_id`, so the contract cannot tell which owner key signed the delegate. Treating it as the owner would let a relayed agent skip Second Look. | `pay.rs` | **Fixed during development**: every relayed `pay` is held to agent rules (never co-signed, strikes count, refused once the agent is revoked); owner methods refuse relayed calls. Tests `relayed_pay_is_held_to_agent_rules`, `relayed_pay_refused_after_the_agent_is_revoked`, `owner_actions_cannot_be_relayed`. |
| TAL-05 | Critical (dependency) | `next@15.5.27` advisory: unauthenticated RCE in the image optimisation API (and a Server Actions DoS). | `web` | **Fixed**: `next@15.5.29`. |
| TAL-06 | High (dependency) | `postcss` ≤ 8.5.22 advisories (source-map file read, path traversal, XSS in stringify), via Next.js. | `web` | **Fixed**: pnpm override `postcss >= 8.5.23`. |
| TAL-07 | Critical (dependency) | `@phala/dcap-qvl-node` ≤ 0.3.3 skipped Intel **QE identity** verification, weakening the agent's TEE attestation check. | `packages/agent` | **Fixed**: replaced by the pure-JS `@phala/dcap-qvl@0.7.1` (PCK chain, TCB info and QE identity). Live re-verification: `UpToDate`, key and nonce bound. |
| TAL-08 | Low (dependency) | `elliptic` (via `@phala/dcap-qvl`) "risky primitive" advisory, no patched version yet. Used only to verify Intel signatures, never to sign. | `packages/agent` | **Open**, accepted. |
| TAL-09 | Info (dependency) | `cargo audit`: `crypto-bigint` timing advisory and unmaintained `wee_alloc`/`unsafe-libyaml`, all reached only through `near-sdk`'s host-side test runner or a feature we don't enable. `cargo tree --target wasm32-unknown-unknown -e normal` shows none of them in the contract wasm. | dev/test only | **Accepted**, not in the deployed artifact. |
| TAL-10 | Low (infra) | `/api/relay` and `/api/onboard` rate limits and the hourly sponsor budget are in-memory per Worker isolate, so they are not global. A determined attacker could drain the **testnet** sponsor faster than intended. | `web/app/api/*` | **Open**, accepted for testnet. Production: move counters to Durable Objects or KV. |
| TAL-11 | Low (design) | Reports need a capsule (0.1 NEAR, refundable), so a sybil with two capsules can make the Guard *warn* about a merchant. Warnings only route purchases to the owner; they never block or move funds. Blocking needs the DAO. | `guard.rs` | **Accepted**. |
| TAL-12 | Info | `set_config` is controlled by the contract account's own key (admin). | `lib.rs` | **Accepted** for testnet; production would hand admin to the DAO. |

## Checks that held

* **Reentrancy / async state:** state is written before every outgoing promise (balance debited, nullifier
  spent, receipt written), and callbacks only restore it on failure. NEAR has no synchronous re-entry.
* **Arithmetic:** release builds use `overflow-checks = true`; daily-cap math uses `checked_add`; refunds use
  `saturating_sub`.
* **Signature replay:** the signed header binds the contract id, merchant id, Merkle root, validity window
  and nonce; a nullifier `(owner, merchant, nonce, item)` prevents double payment. Tests cover replay
  across deployments and merchants.
* **Authorization:** owner methods require `signer == predecessor` and refuse the agent key; `on_*`
  callbacks are `#[private]`; arbiter methods check the arbiter; `ft_on_transfer` ignores other tokens.
* **Front-running / MEV:** prices are fixed by merchant signatures; a front-runner can't change what is paid
  or to whom. The only race is between owner and agent on the same capsule, which the nullifier settles.
* **Oracle manipulation:** none; the only external facts are signatures (Ed25519 menus, MPC, DCAP) and the
  NEAR block clock.

## Remaining risks and limitations

* No independent audit; this review was done by the author.
* A merchant whose menu key leaks can be charged *cheapest-match* purchases at its own signed prices until it
  rotates the key; the owner's caps and the Guard bound the loss.
* The agent's gas allowance is spent on rejected attempts when not relayed; the tripwire limits this.
* NEAR AI Cloud verification checks the TDX quote and its key/nonce binding, not image provenance or RTMR3
  replay; the app (Cloudflare) records a nonce-bound quote digest, while full verification runs in the agent.
* Intents deposits are executed by NEAR Intents (1Click) on mainnet; Tally never holds those funds and cannot
  reverse them.

## Keys and secrets

No secret is committed (checked with a history scan of `git log -p` for private keys and env values).
Demo full-access keys live in `~/.near-credentials`, demo menu/agent keys in `~/.tally/<prefix>/`, the
Agent Market token in `~/.tally/market.json`, and Worker secrets in Cloudflare (`wrangler secret`).
`web/.env.example` documents every variable.
