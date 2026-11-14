/**
 * Picks which menu item satisfies the owner's goal.
 *
 * With NEAR_AI_API_KEY set, a model on NEAR AI Cloud (private inference in a TEE) chooses from
 * the firewalled menu. Without it, a deterministic rule picks the cheapest item in the goal's
 * category. Either way the choice is only a proposal: the contract checks the signed menu, the
 * caps and the floor, and anything that isn't the cheapest match goes to the owner.
 */
import type { SignedMenu } from '@tally-near/sdk';
import { categoryOf, cheapestMatch, firewall } from './firewall.ts';

export type Plan = { index: number; reason: string; planner: string } | { index: null; reason: string; planner: string };

const MODEL = process.env.NEAR_AI_MODEL ?? 'zai-org/GLM-5.1-FP8';
const BASE = process.env.NEAR_AI_BASE_URL ?? 'https://cloud-api.near.ai/v1';

export async function plan(goal: string, menu: SignedMenu, fetchImpl: typeof fetch = fetch): Promise<Plan> {
  const key = process.env.NEAR_AI_API_KEY;
  if (key) {
    try {
      return await planWithModel(goal, menu, key, fetchImpl);
    } catch (e) {
      const fallback = planWithRules(goal, menu);
      return { ...fallback, reason: `${fallback.reason} (model unavailable: ${(e as Error).message.slice(0, 60)})` };
    }
  }
  return planWithRules(goal, menu);
}

export function planWithRules(goal: string, menu: SignedMenu): Plan {
  const cat = categoryOf(goal);
  if (cat === null) return { index: null, reason: 'goal names no category this agent buys', planner: 'rules' };
  const i = cheapestMatch(menu, cat);
  if (i === null) return { index: null, reason: 'merchant sells nothing in that category', planner: 'rules' };
  return { index: i, reason: `cheapest ${firewall(menu)[i].category} on the signed menu`, planner: 'rules' };
}

async function planWithModel(goal: string, menu: SignedMenu, key: string, fetchImpl: typeof fetch): Promise<Plan> {
  const items = firewall(menu);
  const body = {
    model: MODEL,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You buy one item for the user from a list. Reply with JSON only: {"index": <number or null>, "reason": "<one short line>"}. ' +
          'Prefer the cheapest item that satisfies the goal. If nothing fits, index is null.',
      },
      { role: 'user', content: `Goal: ${goal}\nItems: ${JSON.stringify(items)}` },
    ],
  };
  const r = await fetchImpl(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { choices: { message: { content: string } }[] };
  const text = j.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { index: number | null; reason?: string };
  const index = parsed.index;
  if (index !== null && !(Number.isInteger(index) && index >= 0 && index < items.length)) throw new Error('model chose an index outside the menu');
  const reason = String(parsed.reason ?? '').slice(0, 120) || 'model choice';
  return index === null ? { index: null, reason, planner: `near-ai:${MODEL}` } : { index, reason, planner: `near-ai:${MODEL}` };
}
