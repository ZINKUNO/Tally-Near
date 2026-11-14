import { it, expect } from "vitest";
import { signMenu, DEMO_ITEMS } from "../lib/counter";
import { signedBy } from "../lib/verify";
import { CAFE, testKeys } from "./keys";

const a = testKeys(1).merchant;
const b = testKeys(2).merchant;

it("accepts a menu signed by the counter's registered key", async () => {
  const m = await signMenu(a, CAFE, DEMO_ITEMS, 1000, 1n);
  expect(await signedBy(m, a.publicKey)).toBe(true);
});
it("rejects a menu signed by anyone else", async () => {
  const m = await signMenu(b, CAFE, DEMO_ITEMS, 1000, 1n);
  expect(await signedBy(m, a.publicKey)).toBe(false);
});
it("rejects a garbage signature without throwing", async () => {
  const m = await signMenu(a, CAFE, DEMO_ITEMS, 1000, 1n);
  expect(await signedBy({ ...m, sig: "1234" }, a.publicKey)).toBe(false);
});
it("binds the signature to the merchant account in the header", async () => {
  const m = await signMenu(a, CAFE, DEMO_ITEMS, 1000, 1n);
  expect(await signedBy({ ...m, header: { ...m.header, merchant: "evil.testnet" } }, a.publicKey)).toBe(false);
});
