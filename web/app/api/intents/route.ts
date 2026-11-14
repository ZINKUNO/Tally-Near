import { NextResponse } from "next/server";
import { ONECLICK, depositRequest, parseDeposit, parseStatus, type OriginId } from "@/lib/intents";
import { createLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = createLimiter(30, 3_600_000);
const auth = (): Record<string, string> => (process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {});

/**
 * Real NEAR Intents execution (mainnet). POST { from, usd, recipient, refundTo } returns a 1Click deposit
 * address: whoever sends that much USDC there on the origin chain gets NEAR USDC delivered to `recipient`.
 * GET ?depositAddress=… returns the swap's status. Tally never holds these funds.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!perIp(ip)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { from?: OriginId; usd?: number; recipient?: string; refundTo?: string };
  let body;
  try {
    body = depositRequest(b.from as OriginId, Number(b.usd), String(b.recipient ?? ""), String(b.refundTo ?? ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const r = await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return NextResponse.json(parseDeposit(await r.json()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const addr = new URL(req.url).searchParams.get("depositAddress") ?? "";
  if (!/^[0-9a-zA-Z]{20,100}$/.test(addr)) return NextResponse.json({ error: "bad deposit address" }, { status: 400 });
  const r = await fetch(`${ONECLICK}/status?depositAddress=${addr}`, { headers: auth(), signal: AbortSignal.timeout(10_000) });
  const j = await r.json();
  if (!r.ok) return NextResponse.json({ status: "PENDING_DEPOSIT", note: j.message }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json(parseStatus(j), { headers: { "cache-control": "no-store" } });
}
