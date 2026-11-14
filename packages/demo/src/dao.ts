/**
 * Sputnik DAO as Tally's arbiter. Re-runnable.
 *
 *   1. create `tally-arbiter.sputnikv2.testnet` with a two-member council (arbiter + bob)
 *   2. point Tally's `arbiter` at the DAO (admin call)
 *   3. alice disputes one of her settled receipts, committing to evidence by hash
 *   4. a council member proposes `resolve_dispute(receipt, upheld, slash 0.05 NEAR)` as a DAO FunctionCall
 *   5. both members vote; the DAO executes the call; the merchant's bond pays alice
 *
 * Every step prints its transaction. Disputes no longer depend on one trusted key.
 */
import { enc, explorerTx, hex, sha } from '@tally-near/sdk';
import { client, fullAccess, ids, loadLiveKeys, log, near, TGAS } from './env.ts';

const FACTORY = 'sputnikv2.testnet';
const DAO = `tally-arbiter.${FACTORY}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');

async function tx(who: string, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n, gas = 200n * TGAS) {
  const r = (await fullAccess(who).callFunctionRaw({ contractId, methodName, args, deposit, gas })) as unknown as {
    transaction: { hash: string };
    status: { SuccessValue?: string; Failure?: unknown };
  };
  if (r.status.Failure) throw new Error(`${methodName}: ${JSON.stringify(r.status.Failure)}`);
  return { hash: r.transaction.hash, value: r.status.SuccessValue ? JSON.parse(Buffer.from(r.status.SuccessValue, 'base64').toString() || 'null') : null };
}

const view = (contractId: string, method: string, args: object = {}) => client.provider.callFunction({ contractId, method, args }) as Promise<any>;

async function main() {
  const council = [ids.arbiter, ids.owner2];
  await loadLiveKeys([ids.contract, ids.owner, ids.merchant, ...council]);

  const exists = await view(DAO, 'get_policy').catch(() => null);
  if (!exists) {
    const r = await tx(ids.merchant, FACTORY, 'create', {
      name: 'tally-arbiter',
      args: b64({ config: { name: 'tally-arbiter', purpose: 'Rules on Tally purchase disputes and the shared merchant blocklist', metadata: '' }, policy: council }),
    }, near(6), 300n * TGAS);
    log('dao', `created ${DAO} with council ${council.join(', ')}  ${explorerTx(r.hash)}`);
  } else log('dao', `${DAO} exists`);

  const cfg = await client.config();
  if (cfg.arbiter !== DAO) {
    const r = await tx(ids.contract, ids.contract, 'set_config', { arbiter: DAO });
    log('arbiter', `Tally's arbiter is now the DAO  ${explorerTx(r.hash)}`);
  }

  // a settled receipt of alice's that isn't disputed yet
  const receipts = await client.receipts(ids.owner, 50);
  const target = receipts.find((r) => r.status === 'settled' && r.merchant_id === ids.merchant);
  if (!target) throw new Error('no settled receipt to dispute: run `pnpm pay` first');
  const evidence = hex(sha(enc.encode(`receipt ${target.id}: coffee was never served`)));
  const opened = await tx(ids.owner, ids.contract, 'open_dispute', { receipt_id: target.id, evidence_hash: evidence });
  log('dispute', `alice disputes receipt #${target.id} (${Number(target.price) / 1e6} tUSDC)  ${explorerTx(opened.hash)}`);

  const policy = await view(DAO, 'get_policy');
  const kind = {
    FunctionCall: {
      receiver_id: ids.contract,
      actions: [{ method_name: 'resolve_dispute', args: b64({ receipt_id: target.id, upheld: true, slash: near(0.05).toString(), block: false }), deposit: '0', gas: (100n * TGAS).toString() }],
    },
  };
  const proposed = await tx(council[0], DAO, 'add_proposal', { proposal: { description: `Uphold dispute on Tally receipt #${target.id}: refund 0.05 NEAR from the merchant bond`, kind } }, BigInt(policy.proposal_bond));
  const pid = proposed.value as number;
  log('proposal', `#${pid} resolve_dispute(${target.id}, upheld)  ${explorerTx(proposed.hash)}`);

  const before = await client.provider.viewAccount({ accountId: ids.owner } as never) as any;
  for (const member of council) {
    const v = await tx(member, DAO, 'act_proposal', { id: pid, action: 'VoteApprove', proposal: kind }, 0n, 300n * TGAS).catch(async (e) => {
      if (String(e).includes('unknown field') || String(e).includes('proposal')) return tx(member, DAO, 'act_proposal', { id: pid, action: 'VoteApprove' }, 0n, 300n * TGAS);
      throw e;
    });
    log('vote', `${member} approves  ${explorerTx(v.hash)}`);
    const p = await view(DAO, 'get_proposal', { id: pid });
    if (p.status !== 'InProgress') break;
  }

  const p = await view(DAO, 'get_proposal', { id: pid });
  const d = await view(ids.contract, 'get_dispute', { receipt_id: target.id });
  const after = await client.provider.viewAccount({ accountId: ids.owner } as never) as any;
  log('result', `proposal ${p.status}; dispute ${d?.status}; slashed ${Number(BigInt(d?.slashed ?? 0) / 10n ** 21n) / 1000} NEAR to alice (balance ${(Number(BigInt(after.amount) - BigInt(before.amount)) / 1e24).toFixed(3)} NEAR)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
