import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositRequest, parseDeposit, parseStatus } from '../src/intents.ts';

const implicit = 'a'.repeat(64);

test('a live deposit request is not dry, pays a mainnet account and refunds the sender', () => {
  const r = depositRequest('base', 1, implicit, '0x1111111111111111111111111111111111111111', 0);
  assert.equal(r.dry, false);
  assert.equal(r.recipient, implicit);
  assert.equal(r.amount, '1000000');
});

test('refuses testnet recipients and bad refund addresses', () => {
  assert.throws(() => depositRequest('base', 1, 'alice.testnet', '0x1111111111111111111111111111111111111111'));
  assert.throws(() => depositRequest('base', 1, implicit, 'not-an-address'));
});

test('reads deposit addresses and swap status', () => {
  assert.equal(parseDeposit({ quote: { depositAddress: '0xabc', amountIn: '1', amountOut: '1', deadline: 'x', timeEstimate: 35 } }).depositAddress, '0xabc');
  assert.throws(() => parseDeposit({ message: 'refundTo is not valid' }), /refundTo/);
  assert.deepEqual(parseStatus({ status: 'SUCCESS', swapDetails: { amountOut: '995758', destinationChainTxHashes: [{ hash: 'H' }] } }), { status: 'SUCCESS', amountOut: '995758', txHashes: ['H'] });
});
