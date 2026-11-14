import { NextResponse } from "next/server";
import { ONECLICK, parseQuote, quoteRequest, type OriginId } from "@/lib/intents";
import { createLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const perIp = createLimiter(60, 3_600_000);

/** Dry NEAR Intents quote: GET /api/quote?from=base&usd=20. Never deposits or swaps anything. */
export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!perIp(ip)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const u = new URL(req.url);
  let body;
  try {
    body = quoteRequest(u.searchParams.get("from") as OriginId, Number(u.searchParams.get("usd")));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    const r = await fetch(`${ONECLICK}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.ONECLICK_JWT ? { authorization: `Bearer ${process.env.ONECLICK_JWT}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const q = parseQuote(await r.json());
    return q ? NextResponse.json(q, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "no route right now" }, { status: 502 });
  } catch {
    return NextResponse.json({ error: "quote service unreachable" }, { status: 502 });
  }
}
