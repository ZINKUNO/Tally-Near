# Security

Tally is a hackathon project deployed on NEAR **testnet** only. Don't put real funds in it.

Report a vulnerability by opening a GitHub issue titled "security" without exploit details, and we
will reply with a private channel. The threat model is in [`docs/threat-model.md`](docs/threat-model.md).

Keys: no secret is ever committed. Full-access keys for the demo accounts live in
`~/.near-credentials`, demo menu and agent keys in `~/.tally/<prefix>/`, and the app's server secrets
in `web/.env.local` (gitignored; see `web/.env.example`).
