/**
 * One purchase, end to end:
 *
 *   menu      fetch the merchant's signed menu, verify it against the key registered on chain
 *   check     counterparty check (on-chain Guard + account signals): block refuses, warn asks a human
 *   plan      choose an item from the firewalled menu (NEAR AI Cloud or cheapest-match)
 *   attest    pin the NEAR AI Cloud gateway attestation digest to the purchase
 *   preview   dry-run the contract's own checks with `preview_pay`
 *   pay       sign `pay` with the function-call key; the contract decides paid / second_look / rejected
 *
 * Every step is logged into `steps`, so a receipt shows why the agent did what it did.
 */
import {
  AgentWallet, checkCounterparty, menuFromJson, payArgs, verifyMenu,
  type CodePins, type PayOutcome, type SignedMenu, type TallyClient,
} from '@tally-near/sdk';
import type { KeyPairString } from 'near-api-js';
import { gatewayAttestation } from './attestation.ts';
import { firewall } from './firewall.ts';
import { plan } from './planner.ts';

export type Step = { step: string; ok: boolean; detail: string };
export type BuyResult = {
  status: 'paid' | 'second_look' | 'rejected' | 'refused' | 'needs_human' | 'nothing_to_buy';
  steps: Step[];
  outcome?: PayOutcome;
  txHash?: string;
  item?: { name: string; price: string; category: number };
};

export type BuyOptions = {
  goal: string;
  menu: SignedMenu | string;
  client: TallyClient;
  ownerId: string;
  agentKey: KeyPairString;
  pins?: CodePins;
  /** Called when the counterparty check says warn. Return true to continue. Default: stop. */
  askHuman?: (question: string) => Promise<boolean>;
  /** Override the planner's choice (used by the attack demo to simulate a hijacked model). */
  forceIndex?: number;
  /** Why the item was forced, for the step log. */
  forceReason?: string;
  /** Mutate the arguments before signing (attack demo: an agent that lies about the price). */
  tamper?: (args: ReturnType<typeof payArgs>) => void;
  /** Skip the wrapper's own refusals and send anyway, to show the contract still refuses. */
  bypassWrapper?: boolean;
  nearblocks?: string | null;
  minAccountAgeMs?: number;
};

export async function buy(o: BuyOptions): Promise<BuyResult> {
  const steps: Step[] = [];
  const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });

  const menu = typeof o.menu === 'string' ? await loadMenu(o.menu) : o.menu;
  const merchant = await o.client.merchant(menu.merchantId);
  if (!merchant) {
    add('menu', false, `${menu.merchantId} is not a registered merchant`);
    if (!o.bypassWrapper) return { status: 'refused', steps };
  } else {
    const ok = verifyMenu(menu, merchant.signing_key);
    add('menu', ok, ok ? `signature matches ${menu.merchantId}'s registered key, ${menu.items.length} items` : 'menu signature does not match the registered key');
    if (!ok && !o.bypassWrapper) return { status: 'refused', steps };
  }

  const check = await checkCounterparty({ client: o.client, owner: o.ownerId, merchantId: menu.merchantId, pins: o.pins, nearblocks: o.nearblocks, minAccountAgeMs: o.minAccountAgeMs });
  for (const s of check.signals) add(`check:${s.name}`, s.level !== 'block', `${s.level}: ${s.detail}`);
  if (check.decision === 'refuse' && !o.bypassWrapper) {
    add('decision', false, 'counterparty check says block: refusing to sign');
    return { status: 'refused', steps };
  }
  if (check.decision === 'ask_human' && !o.bypassWrapper) {
    const warns = check.signals.filter((s) => s.level === 'warn').map((s) => s.detail).join('; ');
    const yes = o.askHuman ? await o.askHuman(`Pay ${menu.merchantId}? ${warns}`) : false;
    add('decision', yes, yes ? 'human approved despite warnings' : `waiting for a human: ${warns}`);
    if (!yes) return { status: 'needs_human', steps };
  }

  const p = o.forceIndex !== undefined ? { index: o.forceIndex, reason: o.forceReason ?? 'forced choice', planner: 'given' } : await plan(o.goal, menu);
  if (p.index === null) {
    add('plan', false, `${p.planner}: ${p.reason}`);
    return { status: 'nothing_to_buy', steps };
  }
  const safe = firewall(menu)[p.index];
  add('plan', true, `${p.planner}: item #${p.index} (${safe.category}, ${safe.price}) — ${p.reason}`);

  const att = await gatewayAttestation();
  add('attest', !!att, att ? `NEAR AI Cloud gateway quote ${att.digest.slice(0, 16)}… bound to nonce ${att.nonce.slice(0, 8)}…` : 'gateway attestation unavailable');

  const args = payArgs(menu, p.index, { memo: `${o.goal.slice(0, 60)} | ${p.reason}`.slice(0, 150), attestation: att?.label });
  o.tamper?.(args);
  const item = { name: menu.display[menu.items[p.index].id]?.name ?? 'item', price: args.price, category: args.category };

  const preview = await o.client.previewPay(o.ownerId, args);
  add('preview', preview.outcome !== 'rejected', preview.outcome === 'rejected' ? `contract would reject: ${preview.code} — ${preview.reason}` : `contract would answer ${preview.outcome}${preview.reasons.length ? ': ' + preview.reasons.join('; ') : ''}`);
  if (preview.outcome === 'rejected' && !o.bypassWrapper) return { status: 'rejected', steps, item };

  const wallet = new AgentWallet(o.client, o.ownerId, o.agentKey);
  const { outcome, hash } = await wallet.pay(args);
  const detail = outcome.status === 'paid' ? `receipt #${outcome.receipt_id}`
    : outcome.status === 'second_look' ? `parked for the owner (pending #${outcome.pending_id}): ${outcome.reasons.join('; ')}`
    : `${outcome.code}: ${outcome.reason}${outcome.frozen ? ' — capsule FROZEN by tripwire' : ''}`;
  add('pay', outcome.status !== 'rejected', `${outcome.status} — ${detail}`);
  return { status: outcome.status, steps, outcome, txHash: hash, item };
}

export async function loadMenu(urlOrJson: string): Promise<SignedMenu> {
  if (urlOrJson.trim().startsWith('{')) return menuFromJson(urlOrJson);
  const r = await fetch(urlOrJson, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`menu fetch failed: HTTP ${r.status}`);
  return menuFromJson(await r.text());
}
