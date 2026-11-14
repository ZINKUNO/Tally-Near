import type { Receipt as RawReceipt } from "@tally-near/sdk";
import { client } from "./chain";
import type { Hex } from "./menu";

export type Receipt = {
  capsuleId: string;
  merchant: string;
  itemId: Hex;
  category: number;
  price: bigint;
  cosigned: boolean;
  receipt: string;
  /** Known for payments made on this device; contract-only rows link to the receipt instead. */
  txHash?: string;
  timestamp: number;
  status?: string;
  attestation?: string | null;
  name?: string;
  merchantName?: string;
};

export type Topup = { capsuleId: string; from: string; amount: bigint; note: string; txHash?: string; timestamp: number };

export function fromChain(r: RawReceipt): Receipt {
  return {
    capsuleId: r.owner,
    merchant: r.merchant_id,
    itemId: r.item_id,
    category: r.category,
    price: BigInt(r.price),
    cosigned: r.cosigned,
    receipt: `${r.id}`,
    timestamp: Math.floor(r.at_ms / 1000),
    status: r.status,
    attestation: r.attestation,
  };
}

/** On-chain rows win for facts; the device's copy adds the tx hash and the display name it saw at checkout. */
export function mergeReceipts(local: Receipt[], indexed: Receipt[]): Receipt[] {
  const byId = new Map<string, Receipt>();
  for (const r of [...indexed, ...local]) {
    const k = `${r.capsuleId}:${r.receipt}`;
    const prev = byId.get(k);
    byId.set(k, prev ? { ...prev, txHash: prev.txHash ?? r.txHash, name: prev.name ?? r.name, merchantName: prev.merchantName ?? r.merchantName } : r);
  }
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp || Number(b.receipt) - Number(a.receipt));
}

// ---------- local cache (this device's own payments) ----------

const KEY = (id: string) => `tally.receipts.${id}`;

const ser = (r: Receipt) => ({ ...r, price: `${r.price}` });

export function rememberReceipt(r: Receipt) {
  try {
    const all = localReceipts(r.capsuleId);
    localStorage.setItem(KEY(r.capsuleId), JSON.stringify([ser(r), ...all.map(ser)].slice(0, 200)));
  } catch {}
}

export function localReceipts(id: string): Receipt[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(id)) ?? "[]") as (Omit<Receipt, "price"> & { price: string })[];
    return raw.map((x) => ({ ...x, price: BigInt(x.price) }));
  } catch {
    return [];
  }
}

// ---------- the contract is the index ----------

export async function getReceipts(capsuleId: string, limit = 50): Promise<Receipt[]> {
  const rows = await client.receipts(capsuleId, limit).catch(() => [] as RawReceipt[]);
  return mergeReceipts(localReceipts(capsuleId), rows.map(fromChain)).slice(0, limit);
}

/** The owner loading their own allowance is not a top-up from family. */
export function familyOnly(rows: Topup[], owner?: string): Topup[] {
  return owner ? rows.filter((t) => t.from.toLowerCase() !== owner.toLowerCase()) : rows;
}

export async function getTopups(capsuleId: string, owner?: string): Promise<Topup[]> {
  const c = await client.capsule(capsuleId).catch(() => null);
  const raw = ((c as unknown as { topups?: { from: string; amount: string; note: string; at_ms: number }[] })?.topups ?? []).slice().reverse();
  const rows = raw.map((t) => ({ capsuleId, from: t.from, amount: BigInt(t.amount), note: t.note, timestamp: Math.floor(t.at_ms / 1000) }));
  return familyOnly(rows, owner);
}

export async function getSales(merchant: string, limit = 30): Promise<Receipt[]> {
  const rows = (await client.view<RawReceipt[]>("get_sales", { merchant_id: merchant, limit }).catch(() => [])) as RawReceipt[];
  return rows.map(fromChain);
}

export const indexerOn = () => true;

// ---------- blocked attempts (red team and refused payments), shown on Receipts ----------

export type Blocked = { title: string; reason: string; price: bigint; timestamp: number };
const BKEY = (id: string) => `tally.blocked.${id}`;

export function rememberBlocked(id: string, b: Blocked) {
  try {
    const all = blockedAttempts(id).map((x) => ({ ...x, price: `${x.price}` }));
    localStorage.setItem(BKEY(id), JSON.stringify([{ ...b, price: `${b.price}` }, ...all].slice(0, 50)));
  } catch {}
}

export function blockedAttempts(id: string): Blocked[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BKEY(id)) ?? "[]") as (Omit<Blocked, "price"> & { price: string })[];
    return raw.map((x) => ({ ...x, price: BigInt(x.price) }));
  } catch {
    return [];
  }
}
