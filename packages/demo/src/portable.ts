/**
 * Portable receipts (NEAR Chain Signatures): ask the Tally contract to have NEAR's MPC network sign a
 * settled receipt, then verify it independently: recompute the digest, derive Tally's secp256k1 key from the
 * MPC root key, ecrecover. Prints the EVM address any chain can check against.
 *   pnpm portable [receipt_id]
 */
import { explorerTx, verifyPortable, type PortableSig } from '@tally-near/sdk';
import { client, fullAccess, ids, loadLiveKeys, log, TGAS } from './env.ts';

await loadLiveKeys([ids.owner2]);
const arg = process.argv[2];
const receipts = await client.receipts(ids.owner, 50);
const receipt = arg ? await client.view<any>('get_receipt', { receipt_id: Number(arg) }) : receipts.find((r) => r.status === 'settled');
if (!receipt) throw new Error('no settled receipt');
let sig = await client.view<PortableSig | null>('get_receipt_signature', { receipt_id: receipt.id });
if (!sig) {
  const tx: any = await fullAccess(ids.owner2).callFunctionRaw({ contractId: ids.contract, methodName: 'sign_receipt', args: { receipt_id: receipt.id }, deposit: 1n, gas: 300n * TGAS });
  log('sign', `receipt #${receipt.id} sent to the MPC network  ${explorerTx(tx.transaction.hash)}`);
  sig = await client.view<PortableSig | null>('get_receipt_signature', { receipt_id: receipt.id });
}
if (!sig) throw new Error('signature not stored');
const mpcRootKey = (await client.provider.callFunction({ contractId: sig.signer, method: 'public_key', args: {} })) as string;
const c = verifyPortable({ contractId: ids.contract, receipt, sig, mpcRootKey });
log('receipt', `#${receipt.id}: ${Number(receipt.price) / 1e6} tUSDC from ${receipt.owner} to ${receipt.merchant_id}`);
log('digest', `${sig.digest}  recomputed matches: ${c.digestMatches}`);
log('payload', `${sig.payload}  EIP-191 hash matches: ${c.payloadMatches}`);
log('signer', `MPC ${sig.signer}, path "${sig.path}"`);
log('tally', `Tally's derived EVM address ${c.tallyEvmAddress}`);
log('ecrecover', `${c.recoveredAddress}  matches: ${c.signerMatches}`);
log('solidity', `ecrecover(0x${sig.payload}, ${c.v}, 0x${sig.big_r.slice(2)}, 0x${sig.s}) == ${c.tallyEvmAddress}`);
if (!(c.digestMatches && c.payloadMatches && c.signerMatches)) process.exit(2);
