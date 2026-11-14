import { it, expect } from "vitest";
import { NEAR_USDC, parseQuote, quoteRequest } from "../lib/intents";

it("builds a dry exact-input quote into NEAR USDC", () => {
  const r = quoteRequest("base", 20, 0);
  expect(r.dry).toBe(true);
  expect(r.amount).toBe("20000000");
  expect(r.destinationAsset).toBe(NEAR_USDC);
  expect(r.deadline).toBe(new Date(600_000).toISOString());
});

it("refuses unknown origins and silly amounts", () => {
  expect(() => quoteRequest("nowhere" as never, 20)).toThrow();
  expect(() => quoteRequest("base", 0)).toThrow();
  expect(() => quoteRequest("base", 5000)).toThrow();
});

it("reads amount out, time and the implied fee", () => {
  const q = parseQuote({ quote: { amountIn: "20000000", amountOut: "19995065", amountOutUsd: "19.98", timeEstimate: 35 } });
  expect(q).toMatchObject({ amountOut: "19995065", timeEstimate: 35 });
  expect(q!.fee).toBeCloseTo(0.004935, 6);
  expect(parseQuote({})).toBeNull();
});
