/**
 * NEAR Intents (1Click API): what it costs family abroad to send stablecoins from another chain into
 * NEAR. Quotes are `dry: true`, so nothing is deposited or swapped. Intents run on mainnet only (there is
 * no Intents testnet), while this demo allowance holds testnet tUSDC, so the card shows a live price,
 * not a transfer.
 */
export const ONECLICK = "https://1click.chaindefuser.com/v0";
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const ORIGINS = [
  { id: "base", label: "USDC on Base", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near" },
  { id: "arb", label: "USDC on Arbitrum", asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near" },
  { id: "eth", label: "USDC on Ethereum", asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near" },
  { id: "pol", label: "USDC on Polygon", asset: "nep141:pol-0x3c499c542cef5e3811e1192ce70d8cc03d5c3359.omdep.near" },
] as const;
export type OriginId = (typeof ORIGINS)[number]["id"];

export type Quote = { amountIn: string; amountOut: string; amountOutUsd: string; timeEstimate: number; fee: number };

/** Request body for a dry EXACT_INPUT quote of `usd` dollars from `origin` into NEAR USDC. */
export function quoteRequest(origin: OriginId, usd: number, now = Date.now()) {
  const o = ORIGINS.find((x) => x.id === origin);
  if (!o) throw new Error("unknown origin");
  if (!(usd > 0 && usd <= 1000)) throw new Error("amount out of range");
  return {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: o.asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: String(Math.round(usd * 1e6)),
    // a dry quote needs syntactically valid accounts; nothing is sent to them
    refundTo: "0x0000000000000000000000000000000000000001",
    refundType: "ORIGIN_CHAIN",
    recipient: "tally.near",
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(now + 10 * 60_000).toISOString(),
  };
}

export function parseQuote(j: { quote?: { amountIn?: string; amountOut?: string; amountOutUsd?: string; timeEstimate?: number } }): Quote | null {
  const q = j.quote;
  if (!q?.amountIn || !q.amountOut) return null;
  const fee = (Number(q.amountIn) - Number(q.amountOut)) / 1e6;
  return { amountIn: q.amountIn, amountOut: q.amountOut, amountOutUsd: q.amountOutUsd ?? "", timeEstimate: q.timeEstimate ?? 0, fee: Math.max(fee, 0) };
}
