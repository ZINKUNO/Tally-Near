/** Print the deployment's state: config, merchants with Guard verdicts, the owner's capsule and receipts. */
import { fromUnits, explorerAccount } from '@tally-near/sdk';
import { client, ids } from './env.ts';

const [stats, merchants, cap, receipts, pending, blocked] = await Promise.all([
  client.stats(), client.merchants(), client.capsule(ids.owner), client.receipts(ids.owner, 10), client.pending(ids.owner), client.blocklist(),
]);
console.log(`Tally ${ids.contract}  ${explorerAccount(ids.contract)}`);
console.log(`  ${stats.merchants} merchants, ${stats.capsules} capsules, ${stats.receipts} receipts, ${stats.pending} pending, ${stats.blocked} blocked\n`);
for (const [id, m] of merchants) {
  const v = await client.assess(id, ids.owner);
  console.log(`merchant ${id} "${m.name}"  bond ${Number(BigInt(m.bond) / 10n ** 21n) / 1000} NEAR  sales ${m.sales}  guard=${v.level}${v.reasons.length ? ' (' + v.reasons.join('; ') + ')' : ''}`);
}
for (const [id, b] of blocked) console.log(`blocked  ${id}: ${b.reason}`);
if (cap) {
  console.log(`\ncapsule ${ids.owner}: ${fromUnits(cap.balance)} tUSDC, spent today ${fromUnits(cap.spent_in_cycle)}/${fromUnits(cap.rules.daily_cap)}, frozen=${cap.frozen}`);
  console.log(`  agent key ${cap.agent_key}`);
  for (const r of receipts) console.log(`  receipt #${r.id} ${r.status.padEnd(8)} ${fromUnits(r.price).padStart(5)} tUSDC at ${r.merchant_id}${r.cosigned ? ' (co-signed)' : ''}  ${r.memo ?? ''}`);
  for (const p of pending) console.log(`  pending #${p.id} ${fromUnits(p.args.price)} tUSDC: ${p.reasons.join('; ')}`);
}
