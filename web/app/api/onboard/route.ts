import { NextResponse } from "next/server";
import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { TOKEN, TGAS, provider } from "@/lib/chain";
import d from "@/lib/deployments.json";
import { welcomePlan } from "@/lib/onboard";
import { createBudget, createLimiter } from "@/lib/ratelimit";
import { nearBalance, usdBalance } from "@/lib/tally";

export const runtime = "nodejs";

const inFlight = new Set<string>();
// A venue shares one IP, so the per-IP cap is generous; the hourly NEAR budget is the real guard.
const perIp = createLimiter(20, 3_600_000);
const hourlyNear = createBudget(6n * 10n ** 24n, 3_600_000); // 6 NEAR / hour

/**
 * Sponsors a new user. Sending NEAR to a 64-hex implicit account creates it, so the passkey's owner
 * key controls a funded NEAR account after one transfer; then $50 of test USD is minted to it.
 */
export async function POST(req: Request) {
  const { owner } = (await req.json().catch(() => ({}))) as { owner: string };
  let plan;
  try {
    const [ownerNear, ownerUsd] = await Promise.all([nearBalance(owner), usdBalance(owner)]);
    plan = welcomePlan({ owner, ownerNear, ownerUsd });
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (inFlight.has(owner)) return NextResponse.json({ ok: true, pending: true });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (plan.near + plan.usd > 0n && (!perIp(ip) || !hourlyNear(plan.near))) {
    return NextResponse.json({ error: "Lots of new people right now. Try again in a few minutes." }, { status: 429 });
  }
  inFlight.add(owner);
  try {
    const sponsor = new Account(process.env.SPONSOR_ACCOUNT ?? d.sponsor, provider, KeyPairSigner.fromSecretKey(process.env.SPONSOR_KEY as KeyPairString));
    if (plan.near > 0n) await sponsor.transfer({ receiverId: owner, amount: plan.near });
    if (plan.usd > 0n) {
      await sponsor.callFunction({ contractId: TOKEN, methodName: "mint", args: { amount: plan.usd.toString(), account_id: owner }, gas: 30n * TGAS });
    }
    return NextResponse.json({ ok: true, welcomeUsd: Number(plan.usd) / 1e6 });
  } catch (e) {
    console.error("onboard failed", e);
    return NextResponse.json({ error: "Could not add your welcome credit. Try again." }, { status: 502 });
  } finally {
    inFlight.delete(owner);
  }
}
