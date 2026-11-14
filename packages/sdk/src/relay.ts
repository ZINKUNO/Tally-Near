/**
 * Gasless agent payments with NEP-366 meta transactions.
 *
 * The agent signs a *delegate action* (`pay` on Tally, no deposit) with its function-call key; a
 * relayer wraps it in a transaction and pays the gas. Inside the delegated receipt NEAR sets
 * `signer_account_id` to the owner and `signer_account_pk` to the agent key, so the contract applies
 * exactly the same agent rules, and the agent key no longer needs a gas allowance.
 *
 * The relayer only forwards delegates that call `pay` on the configured Tally contract with no
 * deposit, so a stolen relay endpoint can't be used to sponsor anything else.
 */
import { deserialize } from 'borsh';
import { Account, KeyPairSigner, SCHEMA, actions, encodeSignedDelegate, type KeyPairString, type Provider } from 'near-api-js';

/** A borsh-decoded signed delegate (near-api-js exports the class as a type only). */
export type SignedDelegate = {
  delegateAction: { senderId: string; receiverId: string; actions: { functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[]; nonce: bigint; maxBlockHeight: bigint };
  signature: unknown;
};
import type { PayArgs } from './menu.ts';

const toB64 = (b: Uint8Array) => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Agent side: sign `pay(args)` as a delegate action. Returns base64 borsh to POST to a relayer. */
export async function signPayDelegate(opts: { provider: Provider; ownerId: string; agentKey: KeyPairString; contractId: string; args: PayArgs | Record<string, unknown> }): Promise<string> {
  const account = new Account(opts.ownerId, opts.provider, KeyPairSigner.fromSecretKey(opts.agentKey));
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId: opts.contractId,
    actions: [actions.functionCall('pay', { args: opts.args }, 100_000_000_000_000n, 0n)],
    blockHeightTtl: 120,
  });
  return toB64(encodeSignedDelegate(signedDelegate));
}

export type DelegateCheck = { ok: true; delegate: SignedDelegate; senderId: string } | { ok: false; reason: string };

/** Relayer side: decode and check a signed delegate before paying gas for it. */
export function checkPayDelegate(b64: string, contractId: string): DelegateCheck {
  let d: SignedDelegate;
  try {
    d = deserialize(SCHEMA.SignedDelegate, fromB64(b64)) as unknown as SignedDelegate;
    if (!d?.delegateAction?.actions) throw new Error('shape');
  } catch {
    return { ok: false, reason: 'not a signed delegate action' };
  }
  const da = d.delegateAction;
  if (da.receiverId !== contractId) return { ok: false, reason: `relays only calls to ${contractId}` };
  if (da.actions.length !== 1) return { ok: false, reason: 'exactly one action' };
  const fc = da.actions[0].functionCall;
  if (!fc) return { ok: false, reason: 'only function calls' };
  if (fc.methodName !== 'pay') return { ok: false, reason: 'relays only pay' };
  if (BigInt(fc.deposit) !== 0n) return { ok: false, reason: 'no deposits' };
  if (BigInt(fc.gas) > 150_000_000_000_000n) return { ok: false, reason: 'too much gas' };
  return { ok: true, delegate: d, senderId: da.senderId };
}

/** The outcome `pay` returned, read from the receipt the delegate produced. */
export function payOutcomeOf(tx: { receipts_outcome?: { outcome: { status: { SuccessValue?: string; Failure?: unknown }; executor_id: string } }[] }, contractId: string): unknown {
  for (const r of tx.receipts_outcome ?? []) {
    const s = r.outcome.status;
    if (r.outcome.executor_id === contractId && typeof s.SuccessValue === 'string' && s.SuccessValue.length > 0) {
      const v = JSON.parse(new TextDecoder().decode(fromB64(s.SuccessValue)));
      if (v && typeof v === 'object' && 'status' in v) return v;
    }
    if (r.outcome.executor_id === contractId && s.Failure) throw Object.assign(new Error(JSON.stringify(s.Failure)), { failure: s.Failure });
  }
  return null;
}
