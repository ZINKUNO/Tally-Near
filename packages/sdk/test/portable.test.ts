import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyPortable } from '../src/portable.ts';

// a real receipt from tallynear.testnet signed by v1.signer-prod.testnet (NEAR Chain Signatures)
const fx = JSON.parse(readFileSync(new URL('../../../fixtures/portable-receipt.json', import.meta.url), 'utf8'));

test('a live MPC-signed receipt verifies offline against Tally’s derived key', () => {
  const c = verifyPortable(fx);
  assert.deepEqual([c.digestMatches, c.payloadMatches, c.signerMatches], [true, true, true]);
  assert.equal(c.tallyEvmAddress, fx.tallyEvmAddress);
});

test('a tampered receipt or signature fails', () => {
  assert.equal(verifyPortable({ ...fx, receipt: { ...fx.receipt, price: '1' } }).digestMatches, false);
  const s = fx.sig.s.replace(/.$/, (x: string) => (x === '0' ? '1' : '0'));
  assert.equal(verifyPortable({ ...fx, sig: { ...fx.sig, s } }).signerMatches, false);
});
