/**
 * Tally on the NEAR AI Agent Market (market.near.ai): "Tally Guard", a worker agent anyone can hire to
 * check NEAR accounts before an agent pays them.
 *
 *   pnpm market register     create the agent (token saved to ~/.tally/market.json, shown once by the API)
 *   pnpm market list         publish profile + per-call pricing plan
 *   pnpm market work         pick up assignments: find NEAR account ids in the job, run Tally's Guard and
 *                            counterparty check on each, submit a Markdown report
 *   pnpm market board        read-only: open jobs on the board
 *   pnpm market report <id>  print the report Tally Guard would deliver for an account (no market needed)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkCounterparty, explorerAccount, type TallyClient } from '@tally-near/sdk';
import { agentConfig } from './config.ts';

const API = process.env.MARKET_API ?? 'https://api.market.near.ai';
const FILE = join(homedir(), '.tally', 'market.json');
type Creds = { agentId: string; accountId: string; handle: string; apiToken: string };

const creds = (): Creds => {
  if (!existsSync(FILE)) throw new Error('run `pnpm market register` first');
  return JSON.parse(readFileSync(FILE, 'utf8'));
};

async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** NEAR account ids mentioned in free text (named .near/.testnet accounts and 64-hex implicit ones). */
export function accountsIn(text: string): string[] {
  const named = text.match(/\b(?:[a-z\d]+[-_])*[a-z\d]+(?:\.(?:[a-z\d]+[-_])*[a-z\d]+)*\.(?:near|testnet)\b/g) ?? [];
  const implicit = text.match(/\b[0-9a-f]{64}\b/g) ?? [];
  return [...new Set([...named, ...implicit])].slice(0, 10);
}

/** The deliverable: Tally's on-chain Guard verdict plus agent-side signals for each account. */
export async function guardReport(client: TallyClient, accounts: string[]): Promise<string> {
  const lines = [`# Tally Guard report`, ``, `Checked ${accounts.length} NEAR account(s) with Tally's counterparty check (contract \`${client.contractId}\`).`, ``];
  for (const a of accounts) {
    const m = await client.merchant(a).catch(() => null);
    const c = await checkCounterparty({ client, owner: 'tally-guard.near', merchantId: a }).catch((e) => ({ decision: 'refuse' as const, signals: [{ name: 'error', level: 'block' as const, detail: String(e).slice(0, 120) }] }));
    const verdict = c.decision === 'sign' ? 'OK to pay' : c.decision === 'ask_human' ? 'Ask a human first' : 'Do not pay';
    lines.push(`## ${a}: ${verdict}`, ``, m ? `Registered Tally merchant "${m.name}", bond ${Number(BigInt(m.bond) / 10n ** 21n) / 1000} NEAR, ${m.sales} sales.` : 'Not a registered Tally merchant.', '');
    for (const s of c.signals) lines.push(`- **${s.level}** ${s.name}: ${s.detail}`);
    lines.push('', `[Explorer](${explorerAccount(a)})`, '');
  }
  if (!accounts.length) lines.push('No NEAR account ids were found in the job. Reply with the accounts to check, e.g. `cafe.testnet`.');
  return lines.join('\n');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const { client } = agentConfig();
  if (cmd === 'register') {
    if (existsSync(FILE)) return console.log(`already registered: ${creds().handle} (${creds().agentId})`);
    const r = await api<Creds>('POST', '/v1/agents/register', { handle: process.env.MARKET_HANDLE ?? 'tally-guard', name: 'Tally Guard', category: 'finance' });
    mkdirSync(join(homedir(), '.tally'), { recursive: true });
    writeFileSync(FILE, JSON.stringify(r, null, 2), { mode: 0o600 });
    console.log(`registered ${r.handle}: agent ${r.agentId}, account ${r.accountId} (token saved to ${FILE})`);
  } else if (cmd === 'list') {
    const c = creds();
    await api('PATCH', `/v1/agents/${c.agentId}`, {
      description: 'Checks NEAR accounts before your agent pays them: on-chain Guard, bonds, blocklist, account age.',
      bio_markdown:
        'Tally Guard runs the counterparty check from **Tally** (agent payments on NEAR) on any NEAR account you name: ' +
        "the Tally contract's on-chain Guard (shared blocklist, merchant bond, recent payout or key changes, owner reports) " +
        'plus account existence, age and contract code. You get **OK to pay / Ask a human / Do not pay** per account, with reasons.\n\n' +
        'Source: https://github.com/ZINKUNO/Tally-Near',
    }, c.apiToken);
    await api('PATCH', `/v1/agents/${c.agentId}`, { listing_status: 'live' }, c.apiToken).catch(() => {}); // draft -> live
    const plan = await api<{ pricing_plan_id: string }>('POST', `/v1/agents/${c.agentId}/pricing-plans`, { model: 'per_call', price_amount: '1.00', display_name: 'Check up to 10 accounts', description: 'Guard report for up to 10 NEAR accounts', sla_seconds: 3600 }, c.apiToken).catch((e) => ({ pricing_plan_id: `(${String(e).slice(0, 80)})` }));
    console.log(`listed ${c.handle} (live); pricing plan ${plan.pricing_plan_id}`);
  } else if (cmd === 'work') {
    const c = creds();
    const { assignments } = await api<{ assignments: { assignment: { id: string; status: string }; job: { title?: string; description?: string } }[] }>('GET', '/v1/agents/me/assignments', undefined, c.apiToken);
    console.log(`${assignments.length} assignment(s)`);
    for (const a of assignments) {
      if (!['assigned', 'in_progress', 'pending'].includes(a.assignment.status)) continue;
      if (a.assignment.status !== 'in_progress') await api('POST', `/v1/assignments/${a.assignment.id}/start`, {}, c.apiToken).catch(() => {});
      const report = await guardReport(client, accountsIn(`${a.job.title ?? ''}\n${a.job.description ?? ''}`));
      await api('POST', `/v1/assignments/${a.assignment.id}/submit`, { deliverableMarkdown: report }, c.apiToken);
      console.log(`delivered ${a.assignment.id}`);
    }
  } else if (cmd === 'board') {
    const b = await api<{ jobs?: { id: string; title: string; budget_amount?: string }[] }>('GET', '/v1/jobs/board');
    for (const j of b.jobs ?? []) console.log(`${j.id}  ${j.title}`);
  } else if (cmd === 'report') {
    console.log(await guardReport(client, arg ? [arg] : []));
  } else {
    console.log('usage: market register | list | work | board | report <account>');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
