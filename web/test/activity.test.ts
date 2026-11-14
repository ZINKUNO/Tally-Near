import { describe, it, expect } from "vitest";
import { fromChain, mergeReceipts, type Receipt } from "../lib/activity";

const row = {
  id: 7,
  owner: "alice.testnet",
  merchant_id: "cafe.testnet",
  payout: "cafe.testnet",
  menu_root: "00".repeat(32),
  menu_nonce: 1,
  item_id: "00000000000000000000000000000001",
  category: 3,
  price: "4500000",
  floor: "4500000",
  at_ms: 1_700_000_000_000,
  cosigned: false,
  guard: { level: "allow" as const, reasons: [] },
  memo: null,
  attestation: "nearai-gw:abc:def",
  status: "settled" as const,
  evidence_hash: null,
};

describe("activity", () => {
  it("maps an on-chain receipt to the screen's shape with bigints and seconds", () => {
    const r = fromChain(row);
    expect(r.capsuleId).toBe("alice.testnet");
    expect(r.price).toBe(4_500_000n);
    expect(r.timestamp).toBe(1_700_000_000);
    expect(r.receipt).toBe("7");
  });
  it("merges local and on-chain receipts, newest first, without duplicates", () => {
    const a = fromChain(row);
    const b: Receipt = { ...a, receipt: "8", timestamp: 1_700_000_100 };
    const merged = mergeReceipts([a], [a, b]);
    expect(merged.map((x) => x.receipt)).toEqual(["8", "7"]);
  });
  it("keeps the item name and tx hash from this device's copy", () => {
    const a = fromChain(row);
    const merged = mergeReceipts([{ ...a, name: "Oat latte", txHash: "H1" }], [a]);
    expect(merged[0].name).toBe("Oat latte");
    expect(merged[0].txHash).toBe("H1");
  });
});

describe("blocked attempts", () => {
  it("keeps the newest first and survives a reload", async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
    const { rememberBlocked, blockedAttempts } = await import("../lib/activity");
    rememberBlocked("alice.testnet", { title: "Price inflation", reason: "That item or price is not on the signed menu.", price: 9_900_000n, timestamp: 1 });
    rememberBlocked("alice.testnet", { title: "Whisper upsell", reason: "This one needs your approval.", price: 5_900_000n, timestamp: 2 });
    const b = blockedAttempts("alice.testnet");
    expect(b.map((x) => x.title)).toEqual(["Whisper upsell", "Price inflation"]);
    expect(b[1].price).toBe(9_900_000n);
  });
});

describe("family top-ups", () => {
  it("leaves out the owner's own deposits", async () => {
    const { familyOnly } = await import("../lib/activity");
    const rows = [
      { capsuleId: "alice.testnet", from: "alice.testnet", amount: 40n, note: "", timestamp: 1 },
      { capsuleId: "alice.testnet", from: "mum.testnet", amount: 20n, note: "For lunches", timestamp: 2 },
    ];
    expect(familyOnly(rows, "Alice.testnet").map((t) => t.note)).toEqual(["For lunches"]);
  });
});

describe("on-chain attempts", () => {
  it("turns the contract's recorded rejections into blocked rows in plain words", async () => {
    const { onchainBlocked } = await import("../lib/activity");
    const { SENTENCES } = await import("../lib/errors");
    const rows = onchainBlocked([{ at_ms: 2_000, merchant_id: "tallynear-shady.testnet", price: "9990000", code: "guard_block", reason: "x" }], SENTENCES);
    expect(rows[0]).toMatchObject({ price: 9_990_000n, timestamp: 2 });
    expect(rows[0].reason).toMatch(/Guard blocked/);
  });
});
