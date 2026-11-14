import { NextResponse } from "next/server";
import { DEMO_MERCHANT } from "@/lib/chain";
import { DEMO_ITEMS, signMenu } from "@/lib/counter";
import { encodeQr } from "@/lib/menu";
import { chainNow } from "@/lib/tally";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The demo café counter: a freshly signed menu on every request, timed by the chain's clock. */
export async function GET() {
  const secret = process.env.DEMO_MERCHANT_SIGNER_KEY;
  if (!secret) return NextResponse.json({ error: "DEMO_MERCHANT_SIGNER_KEY is not set" }, { status: 500 });
  const now = Number(await chainNow());
  const menu = await signMenu({ secret }, DEMO_MERCHANT, DEMO_ITEMS, now, BigInt(Date.now()));
  return NextResponse.json(
    { qr: encodeQr(menu), expiresAt: Number(menu.header.expiresAt), now },
    { headers: { "cache-control": "no-store" } },
  );
}
