import { it, expect } from "vitest";
import { buildAttacks } from "../lib/attacks";
import { DEMO_ITEMS, signMenu } from "../lib/counter";
import { buildTree } from "../lib/menu";
import { CAFE, testKeys } from "./keys";

const real = testKeys(1).merchant;
const impostor = testKeys(2).merchant;

it("builds four attacks, each expecting a named contract outcome", async () => {
  const menu = await signMenu(real, CAFE, DEMO_ITEMS, 1000, 1n);
  const forged = await signMenu(impostor, CAFE, DEMO_ITEMS, 1000, 2n);
  const a = buildAttacks(menu, forged);
  expect(a.map((x) => x.expect)).toEqual(["bad_signature", "not_on_menu", "not_on_menu", "second_look"]);
});
it("price inflation keeps the real proof but changes the price", async () => {
  const menu = await signMenu(real, CAFE, DEMO_ITEMS, 1000, 1n);
  const a = buildAttacks(menu, menu)[2];
  expect(a.item.price).toBe(9_900_000n);
  expect(a.proof).toEqual(buildTree(DEMO_ITEMS).proofs[0]);
});
