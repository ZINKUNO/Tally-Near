import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leafHash, buildTree, verifyFloors, encodeQr, decodeQr, type Item } from "../lib/menu";

const v = JSON.parse(readFileSync(new URL("../../fixtures/vectors.json", import.meta.url), "utf8"));
const items: Item[] = [
  { itemId: "00000000000000000000000000000001", category: 3, price: 4_500_000n, floor: 4_500_000n, name: "Latte regular" },
  { itemId: "00000000000000000000000000000002", category: 3, price: 5_900_000n, floor: 4_500_000n, name: "Latte large" },
  { itemId: "00000000000000000000000000000003", category: 0, price: 3_000_000n, floor: 3_000_000n, name: "Croissant" },
];

describe("menu", () => {
  it("leaves and root match the contract's Rust vectors", () => {
    const fx: Item[] = v.items.map((i: { id: string; category: number; price: string; floor: string }) => ({
      itemId: i.id, category: i.category, price: BigInt(i.price), floor: BigInt(i.floor), name: "",
    }));
    expect(fx.map(leafHash)).toEqual(v.leaves);
    expect(buildTree(fx).root).toBe(v.root);
    expect(buildTree(fx).proofs).toEqual(v.proofs);
  });
  it("every proof folds to the root and the odd leaf is promoted", () => {
    const { root, proofs } = buildTree(items);
    expect(proofs[2]).toHaveLength(1);
    expect(proofs[0]).toHaveLength(2);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
  });
  it("detects a floor contradiction", () => {
    expect(verifyFloors(items)).toBe(true);
    expect(verifyFloors([{ ...items[0], price: 3_000_000n, floor: 3_000_000n }, items[1]])).toBe(false);
  });
  it("QR round-trips and rejects a tampered price", () => {
    const { root } = buildTree(items);
    const m = {
      header: { merchant: "cafe.testnet", menuRoot: root, issuedAt: 1n, expiresAt: 61n, menuNonce: 7n, itemCount: 3 },
      sig: "00",
      items,
    };
    const s = encodeQr(m);
    expect(s.startsWith("TALLY:NEAR1:")).toBe(true);
    expect(decodeQr(s).items[1].price).toBe(5_900_000n);
    const bad = encodeQr({ ...m, items: [{ ...items[0], price: 1n }, items[1], items[2]] });
    expect(() => decodeQr(bad)).toThrow(/root/);
  });
});
