/**
 * Agent-side counterparty check. Runs before the agent signs anything:
 *
 *   on-chain   the contract's Guard verdict (blocklist, bond, new merchant, payout change, reports)
 *   account    the payout account exists, how old it is (NearBlocks), whether it is a contract
 *   code       a contract payout whose code hash changed since this agent last paid it
 *   history    whether this owner has paid this merchant before
 *
 * `block` means the wrapper refuses to sign. `warn` means it asks a human. The contract runs its
 * own Guard inside `pay` regardless, so a skipped or compromised wrapper cannot pay a blocked
 * merchant; the wrapper only adds signals the chain can't see and saves a wasted strike.
 */
import type { TallyClient, Verdict } from './client.ts';

export type Signal = { name: string; level: 'allow' | 'warn' | 'block'; detail: string };
export type CheckResult = { decision: 'sign' | 'ask_human' | 'refuse'; signals: Signal[] };

const EMPTY_CODE = '11111111111111111111111111111111';
const DAY_MS = 86_400_000;

/** Pinned contract code hashes, keyed by account. Persist it between runs (a JSON file is fine). */
export type CodePins = Record<string, string>;

export async function checkCounterparty(opts: {
  client: TallyClient;
  owner: string;
  merchantId: string;
  pins?: CodePins;
  nearblocks?: string | null;
  fetch?: typeof fetch;
}): Promise<CheckResult> {
  const f = opts.fetch ?? fetch;
  const signals: Signal[] = [];
  const verdict: Verdict = await opts.client.assess(opts.merchantId, opts.owner);
  signals.push({
    name: 'onchain_guard',
    level: verdict.level,
    detail: verdict.reasons.length ? verdict.reasons.join('; ') : 'no on-chain red flags',
  });

  const merchant = await opts.client.merchant(opts.merchantId);
  if (merchant) {
    const payout = merchant.payout;
    const acct = await viewAccount(opts.client, payout);
    if (!acct) {
      signals.push({ name: 'payout_exists', level: 'block', detail: `payout account ${payout} does not exist` });
    } else {
      const isContract = acct.code_hash !== EMPTY_CODE;
      signals.push({ name: 'payout_kind', level: 'allow', detail: isContract ? `${payout} is a contract` : `${payout} is a plain account` });
      if (isContract && opts.pins) {
        const pinned = opts.pins[payout];
        if (pinned && pinned !== acct.code_hash) {
          signals.push({ name: 'code_changed', level: 'warn', detail: `contract code at ${payout} changed since it was last paid` });
        }
        opts.pins[payout] = acct.code_hash;
      }
    }
    const base = opts.nearblocks === undefined ? 'https://api-testnet.nearblocks.io' : opts.nearblocks;
    if (base) {
      try {
        const r = await f(`${base}/v1/account/${payout}`);
        const j = (await r.json()) as { account?: { created?: { block_timestamp?: number | null } }[] };
        const ts = j.account?.[0]?.created?.block_timestamp;
        if (ts) {
          const ageDays = (Date.now() - ts / 1e6) / DAY_MS;
          signals.push({
            name: 'payout_age',
            level: ageDays < 1 ? 'warn' : 'allow',
            detail: `payout account is ${ageDays.toFixed(1)} days old`,
          });
        }
      } catch {
        signals.push({ name: 'payout_age', level: 'allow', detail: 'account age unavailable (NearBlocks unreachable)' });
      }
    }
  }

  const receipts = await opts.client.receipts(opts.owner, 50).catch(() => []);
  const prior = receipts.filter((r) => r.merchant_id === opts.merchantId && r.status === 'settled').length;
  signals.push({ name: 'history', level: 'allow', detail: prior ? `${prior} earlier settled purchase(s) here` : 'first purchase from this merchant' });

  const decision = signals.some((s) => s.level === 'block') ? 'refuse' : signals.some((s) => s.level === 'warn') ? 'ask_human' : 'sign';
  return { decision, signals };
}

async function viewAccount(client: TallyClient, accountId: string): Promise<{ code_hash: string } | null> {
  try {
    return (await client.provider.viewAccount({ accountId })) as unknown as { code_hash: string };
  } catch {
    return null;
  }
}
