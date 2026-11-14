import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KeyPair } from 'near-api-js';
import { hex } from '../src/bytes.ts';
import {
  MerkleTree, buildHeader, computeFloors, leafHash, menuFromJson, menuToJson, payArgs, publicKeyOf,
  signMenu, verifyMenu, verifyProof, base58, toBase58,
} from '../src/menu.ts';

const v = JSON.parse(readFileSync(new URL('../../../fixtures/vectors.json', import.meta.url), 'utf8'));

test('leaves, root, proofs and header match the Rust crate byte for byte', () => {
  const items = v.items.map((i: any) => ({ id: i.id, category: i.category, price: BigInt(i.price), floor: BigInt(i.floor) }));
  const floors = computeFloors(items.map((i: any) => ({ ...i, floor: 0n })));
  assert.deepEqual(floors.map((i) => i.floor), items.map((i: any) => i.floor));
  const leaves = items.map(leafHash);
  assert.deepEqual(leaves.map(hex), v.leaves);
  const tree = new MerkleTree(leaves);
  assert.equal(hex(tree.root()), v.root);
  items.forEach((_: unknown, i: number) => {
    assert.deepEqual(tree.proof(i).map(hex), v.proofs[i]);
    assert.ok(verifyProof(leaves[i], tree.proof(i), tree.root()));
  });
  const header = buildHeader({
    contractId: v.contract_id, merchantId: v.merchant_id, root: v.root,
    issuedAtMs: v.issued_at_ms, expiresAtMs: v.expires_at_ms, nonce: v.menu_nonce, itemCount: items.length,
  });
  assert.equal(hex(header), v.header);
});

test('a NEAR KeyPair signs menus that verify against its public key', () => {
  const kp = KeyPair.fromRandom('ed25519');
  assert.equal(publicKeyOf(kp.toString()), kp.getPublicKey().toString());
  const m = signMenu({
    contractId: 'tally.testnet', merchantId: 'cafe.testnet', secret: kp.toString(), nonce: 1,
    lines: [{ sku: 'flat-white', name: 'Flat white', category: 1, price: 4_500_000n }],
  });
  assert.ok(verifyMenu(m, kp.getPublicKey().toString()));
  const tampered = { ...m, items: [{ ...m.items[0], price: 1n }] };
  assert.ok(!verifyMenu(tampered, kp.getPublicKey().toString()));
  assert.ok(!verifyMenu(m, KeyPair.fromRandom('ed25519').getPublicKey().toString()));
});

test('payArgs carries a proof that verifies, and JSON round-trips bigints', () => {
  const kp = KeyPair.fromRandom('ed25519');
  const m = signMenu({
    contractId: 't', merchantId: 'm', secret: kp.toString(), nonce: 2,
    lines: [1, 2, 3, 4, 5].map((n) => ({ sku: `s${n}`, name: `n${n}`, category: n % 2, price: BigInt(n * 1000) })),
  });
  const a = payArgs(m, 3, { memo: 'x' });
  assert.equal(a.price, '4000');
  assert.equal(a.floor, '2000');
  assert.deepEqual(menuFromJson(menuToJson(m)), m);
});

test('base58 round-trips including leading zeros', () => {
  for (const b of [Uint8Array.of(0, 0, 1, 2), Uint8Array.of(255, 1), new Uint8Array(32).fill(7)]) {
    assert.deepEqual(base58(toBase58(b)), b);
  }
});
