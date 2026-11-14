import { it, expect, describe } from "vitest";
import { preflight } from "../lib/pay";
import { humanError } from "../lib/errors";
import { DEMO_ITEMS } from "../lib/counter";
import { Refused } from "../lib/pay";

const cap = {
  owner: "alice.testnet",
  agent: "ed25519:agent",
  balance: 40_000_000n,
  spentInCycle: 22_000_000n,
  cycleStart: 0n,
  frozen: false,
  rules: { categories: 0b1001n, perTxCap: 10_000_000n, dailyCap: 25_000_000n, minMerchantBond: 200_000_000_000_000_000_000_000n, expiry: 10n ** 12n, allowExtended: false, tripwire: 3 },
} as const;
const menu = (exp: bigint) => ({ header: { expiresAt: exp, issuedAt: exp - 60n } }) as never;
const fresh = { ...cap, spentInCycle: 0n };

describe("preflight", () => {
  it("blocks over-daily before signing, with the numbers", () => {
    const r = preflight(cap as never, 10n ** 24n, menu(100n), DEMO_ITEMS[0], 50n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/\$22\.00 of today's \$25\.00/);
  });
  it("stale menu asks for a refresh", () => {
    const r = preflight(fresh as never, 10n ** 24n, menu(10n), DEMO_ITEMS[0], 50n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("stale");
  });
  it("cheapest match pays alone", () => {
    const r = preflight(fresh as never, 10n ** 24n, menu(100n), DEMO_ITEMS[0], 50n);
    expect(r.ok && r.needsOwner).toBe(false);
  });
  it("pricier pick needs the owner and says by how much", () => {
    const r = preflight(fresh as never, 10n ** 24n, menu(100n), DEMO_ITEMS[1], 50n);
    expect(r.ok && r.needsOwner).toBe(true);
    if (r.ok) expect(r.reasons[0]).toMatch(/\$1\.40 more than the cheapest/);
  });
  it("under-bonded counter needs the owner", () => {
    const r = preflight(fresh as never, 10n ** 23n, menu(100n), DEMO_ITEMS[0], 50n);
    expect(r.ok && r.needsOwner).toBe(true);
  });
  it("blocks categories the family didn't allow", () => {
    const r = preflight(fresh as never, 10n ** 24n, menu(100n), DEMO_ITEMS[4], 50n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/drinks/i);
  });
  it("blocks a paused allowance", () => {
    const r = preflight({ ...fresh, frozen: true } as never, 10n ** 24n, menu(100n), DEMO_ITEMS[0], 50n);
    expect(r.ok).toBe(false);
  });
});

describe("humanError", () => {
  it("maps a duplicate refusal to Already paid", () => {
    expect(humanError(new Refused("duplicate", "this menu item was already paid", false))).toMatch(/already paid/i);
  });
  it("reads the reason out of a contract panic", () => {
    expect(humanError(new Error('{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: NotOnMenu: this item"}}}}'))).toMatch(/not on the signed menu/i);
  });
  it("explains a NEAR access-key refusal", () => {
    expect(humanError(new Error("AccessKeyMethodNameMismatch"))).toMatch(/can only pay/i);
  });
  it("falls back to a plain sentence", () => {
    expect(humanError(new Error("execution reverted 0x1234"))).not.toMatch(/0x|revert/i);
  });
});
