/**
 * Context firewall. The model sees only what a leaf commits to: index, category, price and the
 * category floor. Merchant prose (names, notes, anything a merchant can type) never reaches the
 * prompt, so a menu can't talk the model into anything. The human-readable name is attached
 * again only after the model has chosen, for the receipt and the owner's notification.
 */
import type { SignedMenu } from '@tally-near/sdk';

export type SafeItem = { index: number; category: string; price: string; cheapest_in_category: boolean };

export const CATEGORY_NAMES: Record<number, string> = { 1: 'coffee', 2: 'pastry', 3: 'merch' };

const usd = (units: bigint) => (Number(units) / 1e6).toFixed(2);

export function firewall(menu: SignedMenu, categoryNames = CATEGORY_NAMES): SafeItem[] {
  return menu.items.map((it, index) => ({
    index,
    category: categoryNames[it.category] ?? `category-${it.category}`,
    price: usd(it.price),
    cheapest_in_category: it.price === it.floor,
  }));
}

/** Map a free-text goal to a category id, or null if it names none. */
export function categoryOf(goal: string, categoryNames = CATEGORY_NAMES): number | null {
  const g = goal.toLowerCase();
  const synonyms: Record<string, string[]> = {
    coffee: ['coffee', 'latte', 'espresso', 'flat white', 'cappuccino', 'americano'],
    pastry: ['pastry', 'croissant', 'cake', 'bread', 'muffin', 'snack'],
    merch: ['merch', 'tote', 'bag', 'mug', 'shirt'],
  };
  for (const [id, name] of Object.entries(categoryNames)) {
    if ((synonyms[name] ?? [name]).some((w) => g.includes(w))) return Number(id);
  }
  return null;
}

/** Deterministic cheapest-match: the floor item of the wanted category. */
export function cheapestMatch(menu: SignedMenu, category: number): number | null {
  let best: number | null = null;
  menu.items.forEach((it, i) => {
    if (it.category === category && (best === null || it.price < menu.items[best].price)) best = i;
  });
  return best;
}
