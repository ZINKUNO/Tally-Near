import { NextResponse } from "next/server";
import { Account, KeyPairSigner, type KeyPairString } from "near-api-js";
import { checkPayDelegate, payOutcomeOf } from "@tally-near/sdk";
import { TALLY, provider } from "@/lib/chain";
import d from "@/lib/deployments.json";
import { createLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";

// A venue shares one IP; the per-sender cap is the real guard.
const perIp = createLimiter(120, 3_600_000);
const perSender = createLimiter(60, 3_600_000);

/**
 * NEP-366 relayer: POST { delegate: base64 SignedDelegate }. Pays the gas for an agent's `pay` and nothing
 * else. Inside the delegated receipt NEAR keeps the owner as signer and the agent key as signer key, so the
 * contract's agent rules apply unchanged; the agent key needs no gas allowance.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { delegate } = (await req.json().catch(() => ({}))) as { delegate?: string };
  const check = checkPayDelegate(delegate ?? "", TALLY);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
  if (!perIp(ip) || !perSender(check.senderId)) return NextResponse.json({ error: "slow down" }, { status: 429 });
  try {
    const relayer = new Account(process.env.SPONSOR_ACCOUNT ?? d.sponsor, provider, KeyPairSigner.fromSecretKey(process.env.SPONSOR_KEY as KeyPairString));
    const tx = (await relayer.relayMetaTransaction(check.delegate as never)) as unknown as { transaction: { hash: string }; receipts_outcome: never[] };
    return NextResponse.json({ hash: tx.transaction.hash, outcome: payOutcomeOf(tx, TALLY), relayer: relayer.accountId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
