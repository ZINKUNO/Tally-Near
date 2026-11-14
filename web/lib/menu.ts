import { MerkleTree, buildHeader, hex, leafHash as sdkLeaf } from "@tally-near/sdk";
import { TALLY } from "./chain";

/** Lowercase hex without a prefix (32 chars for an item id, 64 for a root, 128 for a signature). */
export type Hex = string;
export type Item = { itemId: Hex; category: number; price: bigint; floor: bigint; name: string };
export type MenuHeader = {
  merchant: string;
  menuRoot: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
  menuNonce: bigint;
  itemCount: number;
};
export type SignedMenu = { header: MenuHeader; sig: Hex; items: Item[] };

const asSdk = (i: Item) => ({ id: i.itemId, category: i.category, price: i.price, floor: i.floor });

/** leaf = sha256(0x00 ‖ itemId16 ‖ category u16 ‖ price u128 ‖ floor u128), all little-endian, same as the contract */
export const leafHash = (i: Item): Hex => hex(sdkLeaf(asSdk(i)));

/** Sorted-pair tree; an odd node is promoted unchanged, so its proof skips that level. */
export function buildTree(items: Item[]): { root: Hex; proofs: Hex[][] } {
  const t = new MerkleTree(items.map((i) => sdkLeaf(asSdk(i))));
  return { root: hex(t.root()), proofs: items.map((_, i) => t.proof(i).map(hex)) };
}

/** Every leaf's floor must equal the cheapest price in its category (what prove_floor_fraud checks). */
export function verifyFloors(items: Item[]): boolean {
  const min = new Map<number, bigint>();
  for (const i of items) {
    const cur = min.get(i.category);
    if (cur === undefined || i.price < cur) min.set(i.category, i.price);
  }
  return items.every((i) => i.floor === min.get(i.category));
}

/** The 144 bytes a counter signs: this Tally deployment, the merchant account, root, window (ms), nonce, count. */
export function headerBytes(h: MenuHeader): Uint8Array {
  return buildHeader({
    contractId: TALLY,
    merchantId: h.merchant,
    root: h.menuRoot,
    issuedAtMs: Number(h.issuedAt) * 1000,
    expiresAtMs: Number(h.expiresAt) * 1000,
    nonce: Number(h.menuNonce),
    itemCount: h.itemCount,
  });
}

/** The arguments the contract's `pay` takes for one item. */
export function payArgs(m: SignedMenu, item: Item, proof: Hex[], extra: { memo?: string; attestation?: string } = {}) {
  return {
    merchant_id: m.header.merchant,
    menu_root: m.header.menuRoot,
    issued_at_ms: Number(m.header.issuedAt) * 1000,
    expires_at_ms: Number(m.header.expiresAt) * 1000,
    menu_nonce: Number(m.header.menuNonce),
    item_count: m.header.itemCount,
    item_id: item.itemId,
    category: item.category,
    price: item.price.toString(),
    floor: item.floor.toString(),
    proof,
    signature: m.sig,
    memo: extra.memo ?? null,
    attestation: extra.attestation ?? null,
  };
}

const PREFIX = "TALLY:NEAR1:";

function b64uEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeQr(m: SignedMenu): string {
  const h = m.header;
  return (
    PREFIX +
    b64uEncode(
      JSON.stringify({
        m: h.merchant,
        r: h.menuRoot,
        is: `${h.issuedAt}`,
        ex: `${h.expiresAt}`,
        n: `${h.menuNonce}`,
        c: h.itemCount,
        s: m.sig,
        i: m.items.map((x) => [x.itemId, x.category, `${x.price}`, `${x.floor}`, x.name]),
      }),
    )
  );
}

/** Decodes a scanned menu and rebuilds its root, so a tampered item never reaches the agent. */
export function decodeQr(s: string): SignedMenu {
  if (!s.startsWith(PREFIX)) throw new Error("Not a Tally menu");
  const j = JSON.parse(b64uDecode(s.slice(PREFIX.length)));
  const items: Item[] = j.i.map((x: [Hex, number, string, string, string]) => ({
    itemId: x[0],
    category: x[1],
    price: BigInt(x[2]),
    floor: BigInt(x[3]),
    name: x[4],
  }));
  const header: MenuHeader = {
    merchant: j.m,
    menuRoot: j.r,
    issuedAt: BigInt(j.is),
    expiresAt: BigInt(j.ex),
    menuNonce: BigInt(j.n),
    itemCount: j.c,
  };
  if (items.length !== header.itemCount || buildTree(items).root !== header.menuRoot) {
    throw new Error("Menu root mismatch");
  }
  return { header, sig: j.s, items };
}
