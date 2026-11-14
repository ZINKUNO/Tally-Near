/**
 * Seeds a fresh testnet deployment. Re-runnable: every step checks state first.
 *
 *   1. shorten the Guard's "new merchant" window so the demo isn't stuck behind it for 24 h
 *   2. register two merchants with NEAR bonds and Ed25519 menu keys: an honest cafe, and a shady shop
 *   3. register payout accounts with tUSDC and mint the owner 200 tUSDC from the faucet
 *   4. open the owner's capsule and add the agent's function-call key (pay only, 0.5 NEAR gas allowance)
 *   5. fund the capsule with 100 tUSDC through ft_transfer_call
 *   6. a second owner opens a capsule; both report the shady shop with evidence hashes
 *   7. the arbiter puts the shady shop on the shared blocklist
 */
import { sha, hex, enc } from '@tally-near/sdk';
import { client, demoKeys, fullAccess, ids, loadLiveKeys, log, near, pub, TGAS } from './env.ts';

const keys = demoKeys();
const call = (signer: string, contractId: string, methodName: string, args: object, deposit = 0n, gas = 100n * TGAS) =>
  fullAccess(signer).callFunction({ contractId, methodName, args, deposit, gas });

const evidence = (s: string) => hex(sha(enc.encode(s)));

async function main() {
  log('contract', ids.contract);
  await loadLiveKeys(Object.values(ids));
  const window = Number(process.env.GUARD_NEW_MERCHANT_MS ?? 120_000);
  await call(ids.contract, ids.contract, 'set_config', { new_merchant_ms: window, new_key_ms: window });
  log('config', `Guard warns about merchants younger than ${window / 1000}s on this deployment`);

  for (const [id, name, key, bond] of [
    [ids.merchant, 'Corner Cafe', keys.cafeMenu, near(1)],
    [ids.shady, 'Totally Legit Deals', keys.shadyMenu, near(0.5)],
  ] as const) {
    if (await client.merchant(id)) {
      log('merchant', `${id} already registered`);
      continue;
    }
    await call(id, ids.contract, 'register_merchant', { name, signing_key: pub(key), payout: id }, bond);
    await call(id, ids.token, 'mint', { amount: '0' });
    log('merchant', `${id} registered "${name}" with a ${Number(bond / 10n ** 21n) / 1000} NEAR bond`);
  }

  if (!(await client.capsule(ids.owner))) {
    await call(ids.owner, ids.token, 'mint', { amount: '200000000' });
    const rules = {
      per_tx_cap: '10000000',
      daily_cap: '25000000',
      categories: [1, 2],
      min_merchant_bond: near(0.5).toString(),
      expiry_ms: Date.now() + 30 * 86_400_000,
      allow_extended: false,
      tripwire: 3,
    };
    await call(ids.owner, ids.contract, 'create_capsule', { rules, agent_key: pub(keys.agent) }, near(0.1));
    log('capsule', `${ids.owner}: 10 tUSDC per purchase, 25 tUSDC a day, coffee + pastry, tripwire 3`);
  }
  const keyList = await client.provider.viewAccessKeyList({ accountId: ids.owner } as any).catch(() => ({ keys: [] as any[] }));
  if (!(keyList as any).keys.some((k: any) => k.public_key === pub(keys.agent))) {
    await fullAccess(ids.owner).addFunctionCallAccessKey({
      publicKey: pub(keys.agent),
      contractId: ids.contract,
      methodNames: ['pay'],
      allowance: near(0.5),
    });
    log('agent', `function-call key ${pub(keys.agent).slice(0, 20)}… may call only ${ids.contract}.pay`);
  }
  const cap = await client.capsule(ids.owner);
  if (cap && BigInt(cap.balance) < 50_000_000n) {
    await call(ids.owner, ids.token, 'ft_transfer_call', { receiver_id: ids.contract, amount: '100000000', msg: '' }, 1n);
    log('fund', '100 tUSDC moved into the capsule');
  }

  if (!(await client.capsule(ids.owner2))) {
    await call(ids.owner2, ids.contract, 'create_capsule', {
      rules: { per_tx_cap: '0', daily_cap: '0', categories: [], min_merchant_bond: '0', expiry_ms: Date.now() + 86_400_000, allow_extended: false, tripwire: 0 },
      agent_key: null,
    }, near(0.1));
  }
  const reports = await client.view<any[]>('get_reports', { account_id: ids.shady });
  for (const [who, note] of [[ids.owner, 'agent was told to pay a "refund fee" here'], [ids.owner2, 'menu text tried to override agent rules']]) {
    if (reports.some((r) => r.reporter === who)) continue;
    await call(who, ids.contract, 'report', { account_id: ids.shady, evidence_hash: evidence(`${who}:${note}`), note });
    log('report', `${who} reported ${ids.shady}: ${note}`);
  }
  const blocked = await client.blocklist();
  if (!blocked.some(([a]) => a === ids.shady)) {
    await call(ids.arbiter, ids.contract, 'block_account', {
      account_id: ids.shady,
      reason: 'prompt-injection menus and two owner reports',
      evidence_hash: evidence('arbiter ruling: shady'),
    });
    log('blocked', `${ids.shady} is on the shared blocklist`);
  }

  const s = await client.stats();
  log('done', `${s.merchants} merchants, ${s.capsules} capsules, ${s.blocked} blocked. Next: pnpm --filter @tally-near/demo merchant`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
