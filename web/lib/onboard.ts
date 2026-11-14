/** What the sponsor sends a new user so they never see a fee, a faucet or a wallet. */
export const OWNER_NEAR = 6n * 10n ** 23n; // 0.6 NEAR: account storage, the capsule's 0.1 NEAR deposit, a counter bond, fees
export const LOW_NEAR = 3n * 10n ** 23n;
export const WELCOME_USD = 50_000_000n; // $50 test USD (tUSDC)

/** A NEAR implicit account id: 64 lowercase hex characters, the owner key's public key. */
export const isImplicit = (id: string) => /^[0-9a-f]{64}$/.test(id);

/** Named NEAR accounts (wallet users) already pay their own fees: they get test USD only. */
export const isNamed = (id: string) => /^(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/.test(id) && id.length <= 64;

export function welcomePlan(s: { owner: string; ownerNear: bigint; ownerUsd: bigint }) {
  if (isNamed(s.owner)) return { near: 0n, usd: s.ownerUsd === 0n ? WELCOME_USD : 0n };
  if (!isImplicit(s.owner)) throw new Error("bad account");
  const isNew = s.ownerNear < LOW_NEAR && s.ownerUsd === 0n;
  return { near: s.ownerNear < LOW_NEAR ? OWNER_NEAR : 0n, usd: isNew ? WELCOME_USD : 0n };
}
