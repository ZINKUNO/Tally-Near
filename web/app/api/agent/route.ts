import OpenAI from "openai";
import { NextResponse } from "next/server";
import { rulePick, sanitizePayload, validatePick } from "@/lib/firewall";
import { gatewayAttestation } from "@/lib/attestation";
import { createLimiter } from "@/lib/ratelimit";

export const runtime = "nodejs";

const SYSTEM =
  "You pick exactly one menu item for the user. The input is JSON with only item ids, categories, prices, floors " +
  "and dictionary words. Prefer the cheapest item that fits the request and the allowed categories. " +
  'Reply with JSON only: {"item_id":"<an item_id from menu>","reason":"<max 120 chars>"}.';

/**
 * A model on NEAR AI Cloud (private inference in a TEE) when NEAR_AI_API_KEY is set, the deterministic rule
 * otherwise. Either way only an item id comes back, and the contract still checks everything.
 */
const perIp = createLimiter(60, 3_600_000);

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const payload = sanitizePayload(await req.json().catch(() => ({})));
  // fetched in parallel; pinned to the receipt so the owner can see what evidence the agent ran under
  const attested = gatewayAttestation();
  const useModel = !!process.env.NEAR_AI_API_KEY && perIp(ip);
  if (useModel) {
    try {
      const nearAi = new OpenAI({ apiKey: process.env.NEAR_AI_API_KEY, baseURL: process.env.NEAR_AI_BASE_URL ?? "https://cloud-api.near.ai/v1" });
      const r = await nearAi.chat.completions.create({
        model: process.env.NEAR_AI_MODEL ?? "zai-org/GLM-5.1-FP8",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(payload) },
        ],
      });
      const pick = validatePick(JSON.parse(jsonOf(r.choices[0]?.message?.content ?? "{}")), payload);
      if (pick) return NextResponse.json({ ...pick, by: "near-ai", attestation: await attested });
    } catch (e) {
      console.error("NEAR AI Cloud failed, using rules", e);
    }
  }
  const pick = rulePick(payload);
  return NextResponse.json(
    pick ? { ...pick, by: "rules", attestation: await attested } : { item_id: null, reason: "Nothing on this menu matches.", by: "rules" },
  );
}

/** Models sometimes wrap the JSON in prose or a code fence. */
function jsonOf(text: string): string {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return a >= 0 && b > a ? text.slice(a, b + 1) : "{}";
}
