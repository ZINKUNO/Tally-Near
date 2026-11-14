import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import type { Capsule as RawCapsule, Merchant as RawMerchant } from "@tally-near/sdk";
import { TALLY, TGAS, TOKEN, YOCTO, client, provider } from "./chain";
import type { WalletLike } from "./wallet";

export const CATEGORIES = {
  food: 0,
  drinks: 1,
  snacks: 2,
  coffee: 3,
  transit: 4,
  groceries: 5,
  digital: 6,
  services: 7,
  tips: 8,
  merch: 9,
} as const;

export const CATEGORY_LABEL: Record<number, string> = {
  0: "Food",
  1: "Drinks",
  2: "Snacks",
  3: "Coffee",
  4: "Transit",
  5: "Groceries",
  6: "Digital",
  7: "Services",
  8: "Tips",
  9: "Merch",
};

export const CATEGORY_ICON: Record<number, string> = {
  0: "🥪",
  1: "🧃",
  2: "🍪",
  3: "☕",
  4: "🚌",
  5: "🛒",
  6: "📱",
  7: "✂️",
  8: "🙏",
  9: "🛍️",
};

/** Same shape the screens use; times are seconds, money is micro-dollars, bonds are yoctoNEAR. */
export type Rules = {
  categories: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  minMerchantBond: bigint;
  expiry: bigint;
  allowExtended: boolean;
  tripwire: number;
};

export type Capsule = {
  owner: string;
  agent: string;
  balance: bigint;
  spentInCycle: bigint;
  cycleStart: bigint;
  frozen: boolean;
  frozenReason: string | null;
  rules: Rules;
  attempts: RawCapsule["attempts"];
  topups: { from: string; amount: string; note: string; at_ms: number }[];
};

export type Merchant = {
  signingKey: string;
  payout: string;
  name: string;
  bond: bigint;
  slashedTotal: bigint;
  active: boolean;
};

const DAY = 86_400n;
const money = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(2)}`;
export const nearAmount = (yocto: bigint) => `${(Number(yocto / 10n ** 21n) / 1000).toString()} NEAR`;
/** Merchants bonded below this need the owner's approval (the protocol minimum is 0.2 NEAR). */
export const DEFAULT_MIN_BOND = 2n * 10n ** 23n;

export function rulesFromForm(f: { categories: number[]; perPurchase: number; daily: number; days: number; nowSec: number }): Rules {
  if (f.categories.length === 0) throw new Error("Pick at least one thing it can be spent on");
  if (f.perPurchase > f.daily) throw new Error("The per purchase limit can't be above the daily limit");
  const micro = (n: number) => BigInt(Math.round(n * 1e6));
  return {
    categories: f.categories.reduce((b, c) => b | (1n << BigInt(c)), 0n),
    perTxCap: micro(f.perPurchase),
    dailyCap: micro(f.daily),
    minMerchantBond: DEFAULT_MIN_BOND,
    expiry: BigInt(f.nowSec) + BigInt(f.days) * DAY,
    allowExtended: false,
    tripwire: 3,
  };
}

export function categoriesOf(bitmap: bigint): number[] {
  return Object.keys(CATEGORY_LABEL)
    .map(Number)
    .filter((c) => (bitmap >> BigInt(c)) & 1n);
}

export function describeRules(r: Rules): string {
  const names = categoriesOf(r.categories).map((c) => CATEGORY_LABEL[c]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)!.toLowerCase()}` : names[0];
  return `${list}, up to ${money(r.perTxCap)} a purchase and ${money(r.dailyCap)} a day`;
}

/** Mirrors the contract's rolling 24h cycle. */
export function todayUsage(c: { spentInCycle: bigint; cycleStart: bigint }, nowSec: bigint): bigint {
  return nowSec - c.cycleStart >= DAY ? 0n : c.spentInCycle;
}

// ---------- conversions between the contract's JSON and the screens' shapes ----------

export function rulesToJson(r: Rules) {
  return {
    per_tx_cap: r.perTxCap.toString(),
    daily_cap: r.dailyCap.toString(),
    categories: categoriesOf(r.categories),
    min_merchant_bond: r.minMerchantBond.toString(),
    expiry_ms: Number(r.expiry) * 1000,
    allow_extended: r.allowExtended,
    tripwire: r.tripwire,
  };
}

export function fromRaw(owner: string, c: RawCapsule): Capsule {
  return {
    owner,
    agent: c.agent_key ?? "",
    balance: BigInt(c.balance),
    spentInCycle: BigInt(c.spent_in_cycle),
    cycleStart: BigInt(Math.floor(c.cycle_start_ms / 1000)),
    frozen: c.frozen,
    frozenReason: c.frozen_reason,
    attempts: c.attempts,
    topups: (c as unknown as { topups?: Capsule["topups"] }).topups ?? [],
    rules: {
      categories: c.rules.categories.reduce((b, x) => b | (1n << BigInt(x)), 0n),
      perTxCap: BigInt(c.rules.per_tx_cap),
      dailyCap: BigInt(c.rules.daily_cap),
      minMerchantBond: BigInt(c.rules.min_merchant_bond),
      expiry: BigInt(Math.floor(c.rules.expiry_ms / 1000)),
      allowExtended: c.rules.allow_extended,
      tripwire: c.rules.tripwire,
    },
  };
}

// ---------- chain reads ----------

/** A capsule is identified by its owner's NEAR account. */
export async function readCapsule(id: string): Promise<Capsule | null> {
  const c = await client.capsule(id);
  return c ? fromRaw(id, c) : null;
}

export async function getMyCapsule(owner: string): Promise<{ id: string; c: Capsule } | null> {
  const c = await readCapsule(owner);
  return c ? { id: owner, c } : null;
}

export async function readMerchant(accountId: string): Promise<Merchant | null> {
  const m: RawMerchant | null = await client.merchant(accountId).catch(() => null);
  if (!m) return null;
  return { signingKey: m.signing_key, payout: m.payout, name: m.name, bond: BigInt(m.bond), slashedTotal: BigInt(m.slashed_total), active: m.active };
}

export async function usdBalance(accountId: string): Promise<bigint> {
  const b = await provider.callFunction({ contractId: TOKEN, method: "ft_balance_of", args: { account_id: accountId } }).catch(() => "0");
  return BigInt((b as string) ?? "0");
}

export async function nearBalance(accountId: string): Promise<bigint> {
  try {
    return BigInt(((await provider.viewAccount({ accountId } as never)) as unknown as { amount: string }).amount);
  } catch {
    return 0n;
  }
}

/** The chain's clock (latest final block), in seconds. */
export async function chainNow(): Promise<bigint> {
  const b = (await provider.viewBlock({ finality: "final" } as never)) as unknown as { header: { timestamp_nanosec: string } };
  return BigInt(b.header.timestamp_nanosec) / 1_000_000_000n;
}

// ---------- chain writes ----------

export type Signer = { accountId?: string; address: string; secret: KeyPairString; wallet?: WalletLike };

type Outcome = { status: { SuccessValue?: string; Failure?: unknown }; transaction: { hash: string } };

function parseOutcome(tx: Outcome) {
  if (tx.status.Failure) throw Object.assign(new Error(JSON.stringify(tx.status.Failure)), { failure: tx.status.Failure });
  const raw = tx.status.SuccessValue ? atob(tx.status.SuccessValue) : "";
  return { hash: tx.transaction.hash, value: raw ? JSON.parse(raw) : undefined };
}

const accountOf = (who: Signer, accountId = who.accountId ?? who.address) => new Account(accountId, provider, KeyPairSigner.fromSecretKey(who.secret));

/** Sends one function call, waits for the final outcome, throws on failure, returns the hash and return value. */
export async function call(who: Signer, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS, as?: string) {
  if (who.wallet && !as) {
    // a NEAR wallet holds the owner key: it shows the transaction and signs it
    const tx = await who.wallet.signAndSendTransaction({
      receiverId: contractId,
      actions: [{ type: "FunctionCall", params: { methodName, args: args as Record<string, unknown>, gas: gas.toString(), deposit: deposit.toString() } }],
    });
    return parseOutcome(tx as Outcome);
  }
  return parseOutcome((await accountOf(who, as).callFunctionRaw({ contractId, methodName, args, deposit, gas })) as unknown as Outcome);
}

async function addPayKey(owner: Signer, publicKey: string, allowance: bigint) {
  if (owner.wallet) {
    await owner.wallet.signAndSendTransaction({
      receiverId: owner.accountId ?? owner.address,
      actions: [{ type: "AddKey", params: { publicKey, accessKey: { permission: { receiverId: TALLY, methodNames: ["pay"], allowance: allowance.toString() } } } }],
    });
  } else {
    await accountOf(owner).addFunctionCallAccessKey({ publicKey, contractId: TALLY, methodNames: ["pay"], allowance });
  }
}

async function deleteKey(owner: Signer, publicKey: string) {
  if (owner.wallet) {
    await owner.wallet.signAndSendTransaction({ receiverId: owner.accountId ?? owner.address, actions: [{ type: "DeleteKey", params: { publicKey } }] });
  } else {
    await accountOf(owner).deleteKey(publicKey);
  }
}

/** Opens the capsule, gives the agent a key that can only call `pay`, and loads the first deposit. */
export async function createAllowance(owner: Signer, agentPublicKey: string, rules: Rules, deposit: bigint): Promise<string> {
  const id = owner.accountId ?? owner.address;
  if (!(await client.capsule(id))) {
    await call(owner, TALLY, "create_capsule", { rules: rulesToJson(rules), agent_key: agentPublicKey }, YOCTO / 10n);
  }
  const keys = (await provider.viewAccessKeyList({ accountId: id } as never)) as unknown as { keys: { public_key: string }[] };
  if (!keys.keys.some((k) => k.public_key === agentPublicKey)) {
    await addPayKey(owner, agentPublicKey, YOCTO / 4n);
  }
  if (deposit > 0n) await fundAllowance(owner, id, deposit, "");
  return id;
}

/** Moves tUSDC into a capsule: the owner's own, or someone else's (a family top-up). */
export async function fundAllowance(from: Signer, id: string, amount: bigint, note: string) {
  const self = (from.accountId ?? from.address) === id;
  const msg = self && !note ? "" : JSON.stringify({ owner: id, note: note.slice(0, 64) });
  return call(from, TOKEN, "ft_transfer_call", { receiver_id: TALLY, amount: amount.toString(), msg }, 1n);
}

export async function setFrozen(owner: Signer, _id: string, frozen: boolean) {
  return call(owner, TALLY, frozen ? "freeze" : "unfreeze", {});
}

export async function updateRules(owner: Signer, _id: string, rules: Rules) {
  return call(owner, TALLY, "update_rules", { rules: rulesToJson(rules) });
}

/** A merchant account registers once: a NEAR bond, its menu signing key and where sales are paid. */
export async function registerMerchant(owner: Signer, name: string, signingKey: string, bond: bigint) {
  const id = owner.accountId ?? owner.address;
  await call(owner, TOKEN, "mint", { amount: "0" }); // the payout account must hold a tUSDC balance to receive sales
  return call(owner, TALLY, "register_merchant", { name: name.slice(0, 64), signing_key: signingKey, payout: id }, bond);
}

/**
 * Kill switch, stronger than pause: the contract forgets the agent key and the key itself is deleted
 * from the account, so nothing signed with it can even reach Tally.
 */
export async function revokeAgent(owner: Signer, agentPublicKey: string) {
  await call(owner, TALLY, "set_agent_key", { agent_key: null });
  const keys = (await provider.viewAccessKeyList({ accountId: owner.accountId ?? owner.address } as never)) as unknown as { keys: { public_key: string }[] };
  if (keys.keys.some((k) => k.public_key === agentPublicKey)) await deleteKey(owner, agentPublicKey);
}

/** Gives the (same, passkey-derived) agent key back its pay-only access. */
export async function restoreAgent(owner: Signer, agentPublicKey: string) {
  await call(owner, TALLY, "set_agent_key", { agent_key: agentPublicKey });
  const keys = (await provider.viewAccessKeyList({ accountId: owner.accountId ?? owner.address } as never)) as unknown as { keys: { public_key: string }[] };
  if (!keys.keys.some((k) => k.public_key === agentPublicKey)) await addPayKey(owner, agentPublicKey, YOCTO / 4n);
}
