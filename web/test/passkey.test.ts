import { it, expect } from "vitest";
import { KeyPair } from "near-api-js";
import { deriveKeys } from "../lib/passkey";
import { isImplicit, welcomePlan } from "../lib/onboard";

it("one passkey output always derives the same three distinct keys", () => {
  const a = deriveKeys(new Uint8Array(32).fill(9));
  const b = deriveKeys(new Uint8Array(32).fill(9));
  expect(a.owner.secret).toBe(b.owner.secret);
  expect(new Set([a.owner.publicKey, a.agent.publicKey, a.merchant.publicKey]).size).toBe(3);
  expect(deriveKeys(new Uint8Array(32).fill(8)).owner.accountId).not.toBe(a.owner.accountId);
});

it("the owner is a NEAR implicit account named by its public key", () => {
  const k = deriveKeys(new Uint8Array(32).fill(3));
  expect(isImplicit(k.owner.accountId)).toBe(true);
  const pub = KeyPair.fromString(k.owner.secret).getPublicKey().data;
  expect(Buffer.from(pub).toString("hex")).toBe(k.owner.accountId);
});

it("the sponsor funds new implicit accounts once and refuses named or malformed ids", () => {
  const id = deriveKeys(new Uint8Array(32).fill(4)).owner.accountId;
  expect(welcomePlan({ owner: id, ownerNear: 0n, ownerUsd: 0n }).usd).toBe(50_000_000n);
  expect(welcomePlan({ owner: id, ownerNear: 10n ** 24n, ownerUsd: 1n })).toEqual({ near: 0n, usd: 0n });
  expect(() => welcomePlan({ owner: "alice.testnet", ownerNear: 0n, ownerUsd: 0n })).toThrow();
});
