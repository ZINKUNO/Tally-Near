import { it, expect, describe } from "vitest";
import { signMenu, DEMO_ITEMS } from "../lib/counter";
import { verifyFloors, decodeQr, encodeQr } from "../lib/menu";
import { signedBy } from "../lib/verify";
import { CAFE as cafe, testKeys } from "./keys";

const acct = testKeys(1).merchant;

describe("counter", () => {
  it("demo menu has honest floors and the regular latte is the cheapest coffee", () => {
    expect(verifyFloors(DEMO_ITEMS)).toBe(true);
    const coffee = DEMO_ITEMS.filter((i) => i.category === 3);
    expect(coffee[0].price).toBe(coffee[0].floor);
  });
  it("back-dates issuedAt by 5 s with a 60 s window and an ed25519 signature over the header", async () => {
    const m = await signMenu(acct, cafe, DEMO_ITEMS, 1000, 1n);
    expect(m.header.issuedAt).toBe(995n);
    expect(m.header.expiresAt).toBe(1055n);
    expect(m.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await signedBy(m, acct.publicKey)).toBe(true);
  });
  it("signed menu survives the QR round trip", async () => {
    const m = await signMenu(acct, cafe, DEMO_ITEMS, 1000, 1n);
    expect(decodeQr(encodeQr(m)).header.menuRoot).toBe(m.header.menuRoot);
  });
  it("refuses to sign a floor-inconsistent menu", async () => {
    await expect(signMenu(acct, cafe, [{ ...DEMO_ITEMS[1], floor: 1n }], 1000, 1n)).rejects.toThrow(/floor/);
  });
});

describe("merchant menu rows", () => {
  it("computes each category's floor so the menu is honest by construction", async () => {
    const { rowsToItems } = await import("../lib/counter");
    const items = rowsToItems([
      { name: "Filter coffee", price: 2, category: 3 },
      { name: "Cappuccino", price: 3.5, category: 3 },
      { name: "Veg sandwich", price: 4, category: 0 },
    ]);
    expect(items.map((i) => i.floor)).toEqual([2_000_000n, 2_000_000n, 4_000_000n]);
    expect(verifyFloors(items)).toBe(true);
    expect(items[0].itemId).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(items.map((i) => i.itemId)).size).toBe(3);
  });
});

describe("merchant editor input", () => {
  it("skips half-typed rows instead of throwing", async () => {
    const { rowsToItems } = await import("../lib/counter");
    const items = rowsToItems([
      { name: "Filter coffee", price: 2, category: 3 },
      { name: "Cappuccino", price: Number(""), category: 3 },
      { name: "", price: 4, category: 0 },
      { name: "Chai", price: NaN, category: 1 },
    ]);
    expect(items.map((i) => i.name)).toEqual(["Filter coffee", "Cappuccino"].slice(0, 1));
  });
});
