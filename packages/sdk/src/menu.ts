/**
 * Menus: catalog leaves, the sorted-pair Merkle tree and the 144-byte signed header.
 * Byte-for-byte identical to `crates/tally-menu` (checked against fixtures/vectors.json).
 */
import { ed25519 } from '@noble/curves/ed25519';
import { compare, concat, enc, hex, le, sha, unhex } from './bytes.ts';

export const DOMAIN = enc.encode('TALLY_NEAR_MENU1');
export const MAX_AUTONOMOUS_WINDOW_MS = 10 * 60 * 1000;

/** What a leaf commits to. Names and descriptions are display-only and never hashed. */
export type Item = { id: string; category: number; price: bigint; floor: bigint };

/** A catalog line as a merchant writes it. */
export type CatalogLine = { sku: string; name: string; category: number; price: bigint; note?: string };

export type SignedMenu = {
  contractId: string;
  merchantId: string;
  root: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: number;
  items: Item[];
  /** Display text keyed by item id. Never part of what the contract verifies. */
  display: Record<string, { name: string; note?: string }>;
  signature: string;
};

/** 16-byte item id derived from a merchant SKU. */
export const itemId = (sku: string) => hex(sha(enc.encode(sku)).slice(0, 16));

export function leafHash(i: Item): Uint8Array {
  return sha(Uint8Array.of(0), unhex(i.id, 16), le(BigInt(i.category), 2), le(i.price, 16), le(i.floor, 16));
}

export function nodeHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [x, y] = compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha(Uint8Array.of(1), x, y);
}

export function computeFloors<T extends { category: number; price: bigint }>(items: T[]): (T & { floor: bigint })[] {
  return items.map((it) => ({
    ...it,
    floor: items.filter((o) => o.category === it.category).reduce((m, o) => (o.price < m ? o.price : m), it.price),
  }));
}

export class MerkleTree {
  readonly levels: Uint8Array[][];
  constructor(leaves: Uint8Array[]) {
    if (leaves.length === 0) throw new Error('empty menu');
    this.levels = [leaves];
    while (this.levels[this.levels.length - 1].length > 1) {
      const prev = this.levels[this.levels.length - 1];
      const next: Uint8Array[] = [];
      for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? nodeHash(prev[i], prev[i + 1]) : prev[i]);
      this.levels.push(next);
    }
  }
  root(): Uint8Array {
    return this.levels[this.levels.length - 1][0];
  }
  proof(index: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (const level of this.levels.slice(0, -1)) {
      const sib = level[index ^ 1];
      if (sib) out.push(sib);
      index = Math.floor(index / 2);
    }
    return out;
  }
}

export function verifyProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  if (proof.length > 16) return false;
  return compare(proof.reduce((n, s) => nodeHash(n, s), leaf), root) === 0;
}

export type HeaderFields = {
  contractId: string;
  merchantId: string;
  root: string;
  issuedAtMs: number;
  expiresAtMs: number;
  nonce: number;
  itemCount: number;
};

export function buildHeader(f: HeaderFields): Uint8Array {
  const h = concat(
    DOMAIN,
    sha(enc.encode(f.contractId)),
    sha(enc.encode(f.merchantId)),
    unhex(f.root, 32),
    le(BigInt(f.issuedAtMs), 8),
    le(BigInt(f.expiresAtMs), 8),
    le(BigInt(f.nonce), 8),
    le(BigInt(f.itemCount), 4),
    Uint8Array.of(0, 1, 0, 0),
  );
  if (h.length !== 144) throw new Error('header must be 144 bytes');
  return h;
}

const headerOf = (m: Omit<SignedMenu, 'signature' | 'display'>) =>
  buildHeader({
    contractId: m.contractId,
    merchantId: m.merchantId,
    root: m.root,
    issuedAtMs: m.issuedAtMs,
    expiresAtMs: m.expiresAtMs,
    nonce: m.nonce,
    itemCount: m.items.length,
  });

/** Raw 32-byte ed25519 secret from a NEAR `ed25519:<base58 64 bytes>` key or 64/32-byte hex. */
export function secretBytes(secret: string | Uint8Array): Uint8Array {
  if (secret instanceof Uint8Array) return secret.slice(0, 32);
  if (secret.startsWith('ed25519:')) return base58(secret.slice(8)).slice(0, 32);
  return unhex(secret).slice(0, 32);
}

export function publicKeyOf(secret: string | Uint8Array): string {
  return 'ed25519:' + toBase58(ed25519.getPublicKey(secretBytes(secret)));
}

/** Merchant side: compute floors, build the tree, sign the header. */
export function signMenu(opts: {
  contractId: string;
  merchantId: string;
  secret: string | Uint8Array;
  lines: CatalogLine[];
  nonce: number;
  nowMs?: number;
  ttlMs?: number;
}): SignedMenu {
  const issuedAtMs = opts.nowMs ?? Date.now();
  const lines = computeFloors(opts.lines);
  const items: Item[] = lines.map((l) => ({ id: itemId(l.sku), category: l.category, price: l.price, floor: l.floor }));
  const tree = new MerkleTree(items.map(leafHash));
  const base = {
    contractId: opts.contractId,
    merchantId: opts.merchantId,
    root: hex(tree.root()),
    issuedAtMs,
    expiresAtMs: issuedAtMs + (opts.ttlMs ?? 5 * 60 * 1000),
    nonce: opts.nonce,
    items,
  };
  const signature = hex(ed25519.sign(headerOf(base), secretBytes(opts.secret)));
  const display = Object.fromEntries(lines.map((l, i) => [items[i].id, l.note ? { name: l.name, note: l.note } : { name: l.name }]));
  return { ...base, display, signature };
}

/** Anyone: check a menu's signature against a merchant's registered `ed25519:` key. */
export function verifyMenu(m: SignedMenu, merchantKey: string): boolean {
  const tree = new MerkleTree(m.items.map(leafHash));
  if (hex(tree.root()) !== m.root) return false;
  const pk = base58(merchantKey.replace(/^ed25519:/, ''));
  return ed25519.verify(unhex(m.signature, 64), headerOf(m), pk);
}

/** The `PayArgs` JSON the contract's `pay` takes, for one item of a signed menu. */
export function payArgs(m: SignedMenu, index: number, extra: { memo?: string; attestation?: string } = {}) {
  const tree = new MerkleTree(m.items.map(leafHash));
  const it = m.items[index];
  if (!it) throw new Error(`no item ${index}`);
  return {
    merchant_id: m.merchantId,
    menu_root: m.root,
    issued_at_ms: m.issuedAtMs,
    expires_at_ms: m.expiresAtMs,
    menu_nonce: m.nonce,
    item_count: m.items.length,
    item_id: it.id,
    category: it.category,
    price: it.price.toString(),
    floor: it.floor.toString(),
    proof: tree.proof(index).map(hex),
    signature: m.signature,
    memo: extra.memo ?? null,
    attestation: extra.attestation ?? null,
  };
}
export type PayArgs = ReturnType<typeof payArgs>;

/** Serialise a signed menu (bigints as strings) for QR codes, HTTP and files. */
export const menuToJson = (m: SignedMenu) =>
  JSON.stringify({ ...m, items: m.items.map((i) => ({ ...i, price: i.price.toString(), floor: i.floor.toString() })) });

export function menuFromJson(s: string): SignedMenu {
  const o = JSON.parse(s);
  return { ...o, items: o.items.map((i: any) => ({ ...i, price: BigInt(i.price), floor: BigInt(i.floor) })) };
}

// ---- base58 (NEAR key encoding) ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function toBase58(b: Uint8Array): string {
  let n = BigInt('0x' + (hex(b) || '0'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = '1' + out;
  }
  return out;
}
