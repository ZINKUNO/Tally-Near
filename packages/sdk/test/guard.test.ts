import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCounterparty } from '../src/guard.ts';

function fakeClient(o: { level: 'allow' | 'warn' | 'block'; codeHash?: string | null; receipts?: number }) {
  return {
    assess: async () => ({ level: o.level, reasons: o.level === 'allow' ? [] : ['on blocklist'] }),
    merchant: async () => ({ payout: 'pay.testnet' }),
    receipts: async () => Array.from({ length: o.receipts ?? 0 }, () => ({ merchant_id: 'm.testnet', status: 'settled' })),
    provider: {
      viewAccount: async () => {
        if (o.codeHash === null) throw new Error('missing');
        return { code_hash: o.codeHash ?? '11111111111111111111111111111111' };
      },
    },
  } as any;
}

const run = (client: any, pins?: Record<string, string>) =>
  checkCounterparty({ client, owner: 'alice.testnet', merchantId: 'm.testnet', pins, nearblocks: null });

test('clean merchant signs', async () => {
  assert.equal((await run(fakeClient({ level: 'allow', receipts: 2 }))).decision, 'sign');
});

test('on-chain block refuses to sign', async () => {
  assert.equal((await run(fakeClient({ level: 'block' }))).decision, 'refuse');
});

test('on-chain warn asks a human', async () => {
  assert.equal((await run(fakeClient({ level: 'warn' }))).decision, 'ask_human');
});

test('missing payout account refuses', async () => {
  assert.equal((await run(fakeClient({ level: 'allow', codeHash: null }))).decision, 'refuse');
});

test('contract payout whose code changed since last payment asks a human', async () => {
  const pins = { 'pay.testnet': 'OLDHASH' };
  const r = await run(fakeClient({ level: 'allow', codeHash: 'NEWHASH' }), pins);
  assert.equal(r.decision, 'ask_human');
  assert.equal(pins['pay.testnet'], 'NEWHASH');
});

test('young payout account asks a human', async () => {
  const fetchStub = (async () => ({ json: async () => ({ account: [{ created: { block_timestamp: (Date.now() - 3_600_000) * 1e6 } }] }) })) as any;
  const r = await checkCounterparty({ client: fakeClient({ level: 'allow' }), owner: 'a', merchantId: 'm.testnet', nearblocks: 'x', fetch: fetchStub });
  assert.equal(r.decision, 'ask_human');
});
