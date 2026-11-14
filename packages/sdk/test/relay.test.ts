import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPair, actions, buildDelegateAction, encodeDelegateAction, encodeSignedDelegate, Signature } from 'near-api-js';
import { checkPayDelegate } from '../src/relay.ts';

const kp = KeyPair.fromRandom('ed25519');
function delegate(opts: { receiver?: string; method?: string; deposit?: bigint; count?: number } = {}) {
  const fc = actions.functionCall(opts.method ?? 'pay', { args: {} }, 100_000_000_000_000n, opts.deposit ?? 0n);
  const da = buildDelegateAction({
    actions: Array(opts.count ?? 1).fill(fc), maxBlockHeight: 100n, nonce: 1n,
    publicKey: kp.getPublicKey(), receiverId: opts.receiver ?? 'tally.testnet', senderId: 'alice.testnet',
  });
  const sig = kp.sign(new Uint8Array(encodeDelegateAction(da)));
  const bytes = encodeSignedDelegate({ delegateAction: da, signature: new Signature({ keyType: 0, data: sig.signature }) } as never);
  return Buffer.from(bytes).toString('base64');
}

test('the relayer accepts a pay delegate to Tally', () => {
  const r = checkPayDelegate(delegate(), 'tally.testnet');
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.senderId, 'alice.testnet');
});

test('the relayer refuses other contracts, methods, deposits and batches', () => {
  assert.equal(checkPayDelegate(delegate({ receiver: 'evil.testnet' }), 'tally.testnet').ok, false);
  assert.equal(checkPayDelegate(delegate({ method: 'update_rules' }), 'tally.testnet').ok, false);
  assert.equal(checkPayDelegate(delegate({ deposit: 1n }), 'tally.testnet').ok, false);
  assert.equal(checkPayDelegate(delegate({ count: 2 }), 'tally.testnet').ok, false);
  assert.equal(checkPayDelegate('not base64 borsh', 'tally.testnet').ok, false);
});
