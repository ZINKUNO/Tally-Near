import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsIn } from '../src/market.ts';

test('finds named and implicit NEAR accounts in a job description', () => {
  const id = 'ab'.repeat(32);
  const got = accountsIn(`Please check tallynear-shady.testnet and pay.near before my agent pays; also ${id}. Not bob or x.com.`);
  assert.deepEqual(got.sort(), [id, 'pay.near', 'tallynear-shady.testnet'].sort());
  assert.deepEqual(accountsIn('nothing here'), []);
});
