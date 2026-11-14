/**
 * Happy path, as the owner would see it:
 *   1  "get me a coffee"  -> agent buys the cheapest coffee on its own (paid)
 *   2  "a large flat white" -> not the cheapest coffee, so the contract parks it (Second Look)
 *   3  the owner approves with a full-access key -> paid, receipt marked co-signed
 */
import { explorerTx, fromUnits } from '@tally-near/sdk';
import { buy, type BuyResult } from '@tally-near/agent';
import { cafeLines, freshMenu } from './catalogs.ts';
import { client, demoKeys, fullAccess, ids, loadLiveKeys, TGAS } from './env.ts';

const keys = demoKeys();
const base = { client, ownerId: ids.owner, agentKey: keys.agent, minAccountAgeMs: Number(process.env.TALLY_MIN_ACCOUNT_AGE_MS ?? 600_000) };

function show(title: string, r: BuyResult) {
  console.log(`\n${title}`);
  for (const s of r.steps) console.log(`  ${s.ok ? '✔' : '✘'} ${s.step.padEnd(20)} ${s.detail}`);
  console.log(`  => ${r.status.toUpperCase()}${r.item ? ` ${r.item.name} ${fromUnits(r.item.price)} tUSDC` : ''}${r.txHash ? `\n     ${explorerTx(r.txHash)}` : ''}`);
}

await loadLiveKeys([ids.owner]);
const menu = () => freshMenu(ids.contract, ids.merchant, keys.cafeMenu, cafeLines);
show('1. "get me a coffee"', await buy({ ...base, goal: 'get me a coffee', menu: menu() }));

const large = await buy({ ...base, goal: 'a large flat white', menu: menu(), forceIndex: 1, forceReason: 'the owner asked for the large one' });
show('2. "a large flat white" (the agent picks a pricier coffee)', large);

if (large.outcome?.status === 'second_look') {
  const tx: any = await fullAccess(ids.owner).callFunctionRaw({
    contractId: ids.contract, methodName: 'approve', args: { pending_id: large.outcome.pending_id }, gas: 100n * TGAS,
  });
  console.log(`\n3. Owner taps "Approve" (full-access key)\n  => PAID, co-signed\n     ${explorerTx(tx.transaction.hash)}`);
}
const cap = await client.capsule(ids.owner);
console.log(`\nCapsule: ${fromUnits(cap!.balance)} tUSDC left, ${fromUnits(await client.remainingToday(ids.owner))} tUSDC headroom today`);
