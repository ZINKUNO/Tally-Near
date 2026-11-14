/**
 * Verify a portable receipt (NEAR Chain Signatures) without trusting Tally.
 *
 *   1. recompute the receipt digest from the receipt's fields (same bytes as `digest_of` in the contract)
 *   2. EIP-191 hash it: what an EVM contract passes to `ecrecover`
 *   3. derive the secp256k1 key NEAR's MPC network holds for (Tally contract, "tally-receipts"):
 *        epsilon = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" + predecessor + "," + path)
 *        child   = root + epsilon * G
 *   4. recover the signer from (big_r, s, recovery_id) and compare with the derived key / EVM address
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256, sha3_256 } from '@noble/hashes/sha3';
import { base58 } from './menu.ts';
import { concat, enc, hex, le, sha, unhex } from './bytes.ts';
import type { Receipt } from './client.ts';

export type PortableSig = { receipt_id: number; digest: string; payload: string; big_r: string; s: string; recovery_id: number; signer: string; path: string };

export function receiptDigest(contractId: string, r: Pick<Receipt, 'id' | 'owner' | 'merchant_id' | 'payout' | 'item_id' | 'price' | 'at_ms' | 'cosigned'>): string {
  const z = Uint8Array.of(0);
  return hex(
    sha(
      enc.encode('TALLY_RECEIPT_V1'), enc.encode(contractId), z, le(BigInt(r.id), 8),
      enc.encode(r.owner), z, enc.encode(r.merchant_id), z, enc.encode(r.payout), z,
      enc.encode(r.item_id), le(BigInt(r.price), 16), le(BigInt(r.at_ms), 8), Uint8Array.of(r.cosigned ? 1 : 0),
    ),
  );
}

export function ethSignedHash(digestHex: string): string {
  return hex(keccak_256(concat(enc.encode('\x19Ethereum Signed Message:\n32'), unhex(digestHex, 32))));
}

/** Derived child public key (uncompressed hex) for `predecessor` + `path` under the MPC root key `secp256k1:<base58>`. */
export function derivedPublicKey(rootKey: string, predecessor: string, path: string): string {
  const raw = base58(rootKey.replace(/^secp256k1:/, ''));
  const root = secp256k1.ProjectivePoint.fromHex(concat(Uint8Array.of(4), raw));
  const eps = BigInt('0x' + hex(sha3_256(enc.encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`)))) % secp256k1.CURVE.n;
  return root.add(secp256k1.ProjectivePoint.BASE.multiply(eps)).toHex(false);
}

export function evmAddress(uncompressedHex: string): string {
  return '0x' + hex(keccak_256(unhex(uncompressedHex).slice(1))).slice(-40);
}

/** Recovered signer (uncompressed hex) of an MPC signature over `payloadHex`. */
export function recoverSigner(sig: Pick<PortableSig, 'big_r' | 's' | 'recovery_id'>, payloadHex: string): string {
  const r = BigInt('0x' + sig.big_r.slice(2));
  const s = BigInt('0x' + sig.s);
  return new secp256k1.Signature(r, s).addRecoveryBit(sig.recovery_id).recoverPublicKey(unhex(payloadHex, 32)).toHex(false);
}

export type PortableCheck = { digestMatches: boolean; payloadMatches: boolean; signerMatches: boolean; tallyEvmAddress: string; recoveredAddress: string; v: number };

export function verifyPortable(opts: { contractId: string; receipt: Parameters<typeof receiptDigest>[1]; sig: PortableSig; mpcRootKey: string }): PortableCheck {
  const digest = receiptDigest(opts.contractId, opts.receipt);
  const payload = ethSignedHash(digest);
  const expected = derivedPublicKey(opts.mpcRootKey, opts.contractId, opts.sig.path);
  const recovered = recoverSigner(opts.sig, opts.sig.payload);
  return {
    digestMatches: digest === opts.sig.digest,
    payloadMatches: payload === opts.sig.payload,
    signerMatches: recovered === expected,
    tallyEvmAddress: evmAddress(expected),
    recoveredAddress: evmAddress(recovered),
    v: 27 + opts.sig.recovery_id,
  };
}
