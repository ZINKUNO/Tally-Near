import { deriveKeys } from "../lib/passkey";

/** Deterministic test keys: a fake passkey PRF output per seed byte. */
export const testKeys = (seed: number) => deriveKeys(new Uint8Array(32).fill(seed));
export const CAFE = "cafe.testnet";
