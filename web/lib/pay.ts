import { client, TALLY } from "./chain";
import { buildTree, payArgs, type Item, type SignedMenu } from "./menu";
import { CATEGORY_LABEL, call, nearAmount, todayUsage, type Capsule, type Signer } from "./tally";

export type Preflight =
  | { ok: true; needsOwner: boolean; reasons: string[] }
  | { ok: false; code: "paused" | "expired" | "stale" | "category" | "per-tx" | "daily" | "balance" | "paid"; message: string };

const money = (micro: bigint) => `$${(Number(micro) / 1e6).toFixed(2)}`;

/** Runs the contract's checks on the phone first, in the same order, so the user hears "no" before Face ID. */
export function preflight(c: Capsule, merchantBond: bigint, m: SignedMenu, item: Item, nowSec: bigint): Preflight {
  if (c.frozen) return { ok: false, code: "paused", message: "Your allowance is paused. Resume it on Home." };
  if (nowSec >= c.rules.expiry) return { ok: false, code: "expired", message: "This allowance has ended." };
  if (nowSec > m.header.expiresAt || nowSec < m.header.issuedAt) {
    return { ok: false, code: "stale", message: "The menu refreshed. Tap to get the new one." };
  }
  if (((c.rules.categories >> BigInt(item.category)) & 1n) === 0n) {
    return { ok: false, code: "category", message: `Your allowance can't be spent on ${CATEGORY_LABEL[item.category]?.toLowerCase() ?? "this"}.` };
  }
  if (item.price > c.rules.perTxCap) {
    return { ok: false, code: "per-tx", message: `That's above your ${money(c.rules.perTxCap)} per-purchase limit.` };
  }
  const spent = todayUsage(c, nowSec);
  if (spent + item.price > c.rules.dailyCap) {
    return { ok: false, code: "daily", message: `You've used ${money(spent)} of today's ${money(c.rules.dailyCap)}.` };
  }
  if (item.price > c.balance) return { ok: false, code: "balance", message: `Only ${money(c.balance)} left. Ask family to top up.` };

  const reasons: string[] = [];
  if (item.price > item.floor) reasons.push(`It's ${money(item.price - item.floor)} more than the cheapest ${CATEGORY_LABEL[item.category]?.toLowerCase()} (${money(item.floor)}).`);
  if (merchantBond < c.rules.minMerchantBond) reasons.push(`This counter's bond is ${nearAmount(merchantBond)}, below your ${nearAmount(c.rules.minMerchantBond)} minimum.`);
  if (m.header.expiresAt - m.header.issuedAt > 600n) reasons.push("This is a printed menu, not a live one.");
  return { ok: true, needsOwner: reasons.length > 0, reasons };
}

type Outcome =
  | { status: "paid"; receipt_id: number }
  | { status: "second_look"; pending_id: number; reasons: string[] }
  | { status: "rejected"; code: string; reason: string; frozen: boolean };

/** A refused payment, carrying the contract's reason code for `humanError`. */
export class Refused extends Error {
  constructor(public code: string, public reason: string, public frozen: boolean) {
    super(`${code}: ${reason}`);
  }
}

/**
 * The agent's function-call key submits `pay` on the owner's account. When the owner must approve,
 * the contract parks it as a Second Look and the owner key (after a fresh Face ID) approves it.
 */
export async function pay(
  agent: Signer,
  owner: Signer | null,
  capsuleId: string,
  m: SignedMenu,
  item: Item,
  extra: { memo?: string; attestation?: string } = {},
): Promise<{ hash: string; receipt: string; ms: number; cosigned: boolean }> {
  const idx = m.items.findIndex((i) => i.itemId === item.itemId);
  if (idx < 0) throw new Error("Item not on this menu");
  const args = payArgs(m, item, buildTree(m.items).proofs[idx], extra);
  const t0 = performance.now(); // settlement time: broadcast → final outcome
  const r = await call(agent, TALLY, "pay", { args }, 0n, undefined, capsuleId);
  const out = r.value as Outcome;
  if (out.status === "rejected") throw new Refused(out.code, out.reason, out.frozen);
  if (out.status === "paid") return { hash: r.hash, receipt: `${out.receipt_id}`, ms: Math.round(performance.now() - t0), cosigned: false };
  if (!owner) throw new Refused("second_look", out.reasons.join("; "), false);
  const a = await call(owner, TALLY, "approve", { pending_id: out.pending_id });
  return { hash: a.hash, receipt: `${(a.value as { receipt_id: number }).receipt_id}`, ms: Math.round(performance.now() - t0), cosigned: true };
}

/** Checked before Face ID, so a repeat tap hears "Already paid" without a prompt. */
export async function alreadyPaid(capsuleId: string, m: SignedMenu, item: Item): Promise<boolean> {
  const idx = m.items.findIndex((i) => i.itemId === item.itemId);
  const p = await client.previewPay(capsuleId, payArgs(m, item, buildTree(m.items).proofs[idx]) as never);
  return p.code === "duplicate";
}
