/**
 * Thin client for the Tally contract. Views go through public RPC; `AgentWallet` signs `pay`
 * with the capsule's function-call key and nothing else.
 */
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner, type KeyPairString } from 'near-api-js';
import type { PayArgs } from './menu.ts';
import { signPayDelegate } from './relay.ts';

export const RPC = {
  testnet: 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org',
  mainnet: 'https://free.rpc.fastnear.com,https://near.drpc.org',
} as const;

export type Level = 'allow' | 'warn' | 'block';
export type Verdict = { level: Level; reasons: string[] };
export type Reject =
  | 'frozen' | 'expired' | 'unknown_merchant' | 'merchant_inactive' | 'guard_block' | 'bad_signature' | 'stale'
  | 'window_too_long' | 'not_on_menu' | 'category' | 'over_per_tx' | 'over_daily' | 'insufficient_balance'
  | 'duplicate' | 'bad_args';
export type PayOutcome =
  | { status: 'paid'; receipt_id: number }
  | { status: 'second_look'; pending_id: number; reasons: string[] }
  | { status: 'rejected'; code: Reject; reason: string; frozen: boolean };

export type Rules = {
  per_tx_cap: string;
  daily_cap: string;
  categories: number[];
  min_merchant_bond: string;
  expiry_ms: number;
  allow_extended: boolean;
  tripwire: number;
};

export type Merchant = {
  name: string;
  signing_key: string;
  key_history: string[];
  payout: string;
  bond: string;
  slashed_total: string;
  registered_at_ms: number;
  payout_changed_at_ms: number;
  key_rotated_at_ms: number;
  bond_unlock_at_ms: number | null;
  open_disputes: number;
  sales: number;
  active: boolean;
};

export type Attempt = { at_ms: number; merchant_id: string; price: string; code: Reject; reason: string };

export type Capsule = {
  agent_key: string | null;
  rules: Rules;
  balance: string;
  spent_in_cycle: string;
  cycle_start_ms: number;
  total_spent: string;
  frozen: boolean;
  frozen_reason: string | null;
  strikes: number[];
  attempts: Attempt[];
  storage_deposit: string;
  created_at_ms: number;
};

export type Receipt = {
  id: number;
  owner: string;
  merchant_id: string;
  payout: string;
  menu_root: string;
  menu_nonce: number;
  item_id: string;
  category: number;
  price: string;
  floor: string;
  at_ms: number;
  cosigned: boolean;
  guard: Verdict;
  memo: string | null;
  attestation: string | null;
  status: 'sending' | 'settled' | 'refunded' | 'disputed' | 'dispute_upheld' | 'dispute_rejected';
  evidence_hash: string | null;
};

export type Pending = {
  id: number;
  owner: string;
  args: PayArgs;
  reasons: string[];
  guard: Verdict;
  proposed_at_ms: number;
  expires_at_ms: number;
};

export type Preview = { outcome: 'paid' | 'second_look' | 'rejected'; code: Reject | null; reason: string | null; reasons: string[]; guard: Verdict | null };

export class TallyClient {
  readonly provider: FailoverRpcProvider;
  readonly contractId: string;
  /** `rpcUrl` may list several comma-separated endpoints; calls fail over between them. */
  constructor(contractId: string, rpcUrl: string = RPC.testnet) {
    this.contractId = contractId;
    this.provider = new FailoverRpcProvider(rpcUrl.split(',').map((url) => new JsonRpcProvider({ url: url.trim() })));
  }

  view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.provider.callFunction({ contractId: this.contractId, method, args }) as Promise<T>;
  }

  config = () => this.view<Record<string, unknown>>('get_config');
  stats = () => this.view<Record<string, number>>('stats');
  merchant = (merchant_id: string) => this.view<Merchant | null>('get_merchant', { merchant_id });
  merchants = () => this.view<[string, Merchant][]>('list_merchants', {});
  capsule = (owner: string) => this.view<Capsule | null>('get_capsule', { owner });
  receipts = (owner: string, limit = 50) => this.view<Receipt[]>('get_receipts', { owner, limit });
  pending = (owner: string) => this.view<Pending[]>('get_pending', { owner });
  assess = (merchant_id: string, owner?: string) => this.view<Verdict>('assess', { merchant_id, owner: owner ?? null });
  previewPay = (owner: string, args: PayArgs) => this.view<Preview>('preview_pay', { owner, args });
  remainingToday = (owner: string) => this.view<string>('remaining_today', { owner });
  blocklist = () => this.view<[string, { reason: string; evidence_hash: string | null; at_ms: number }][]>('get_blocklist');
}

/**
 * The agent's wallet: the owner's account id plus a function-call key that may only call
 * `pay` on the Tally contract. It cannot transfer NEAR, add keys, call other contracts or
 * attach a deposit; the protocol enforces that before the contract is even reached.
 */
export class AgentWallet {
  readonly account: Account;
  readonly client: TallyClient;
  readonly ownerId: string;
  private readonly agentKey: KeyPairString;
  constructor(client: TallyClient, ownerId: string, agentKey: KeyPairString) {
    this.client = client;
    this.ownerId = ownerId;
    this.agentKey = agentKey;
    this.account = new Account(ownerId, client.provider, KeyPairSigner.fromSecretKey(agentKey));
  }

  /** Gasless: sign `pay` as a NEP-366 delegate and let a relayer (e.g. the app's `/api/relay`) pay the gas. */
  async payGasless(args: PayArgs, relayUrl: string): Promise<{ outcome: PayOutcome; hash: string }> {
    const delegate = await signPayDelegate({ provider: this.client.provider, ownerId: this.ownerId, agentKey: this.agentKey, contractId: this.client.contractId, args });
    const r = await fetch(relayUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delegate }) });
    const j = (await r.json()) as { hash?: string; outcome?: PayOutcome; error?: string };
    if (!r.ok || !j.outcome) throw new Error(`relay: ${j.error ?? r.status}`);
    return { outcome: j.outcome, hash: j.hash ?? '' };
  }

  async pay(args: PayArgs): Promise<{ outcome: PayOutcome; hash: string }> {
    const tx = await this.account.callFunctionRaw({
      contractId: this.client.contractId,
      methodName: 'pay',
      args: { args },
      gas: 100_000_000_000_000n,
    });
    const status = tx.status as { SuccessValue?: string; Failure?: unknown };
    if (status.Failure) throw new Error(`pay failed: ${JSON.stringify(status.Failure)}`);
    const outcome = JSON.parse(Buffer.from(status.SuccessValue ?? '', 'base64').toString()) as PayOutcome;
    return { outcome, hash: tx.transaction.hash };
  }
}

export const explorerTx = (hash: string, network: 'testnet' | 'mainnet' = 'testnet') =>
  `https://${network === 'testnet' ? 'testnet.' : ''}nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string, network: 'testnet' | 'mainnet' = 'testnet') =>
  `https://${network === 'testnet' ? 'testnet.' : ''}nearblocks.io/address/${id}`;

/** "4.5" <-> 4500000 for 6-decimal tokens. Exact string math. */
export function toUnits(value: string, dec = 6): bigint {
  const [w, f = ''] = value.trim().split('.');
  if (!/^\d*$/.test(w) || !/^\d*$/.test(f) || f.length > dec) throw new Error(`invalid amount "${value}"`);
  return BigInt((w || '0') + f.padEnd(dec, '0'));
}
export function fromUnits(units: bigint | string, dec = 6): string {
  const s = BigInt(units).toString().padStart(dec + 1, '0');
  const frac = s.slice(-dec).replace(/0+$/, '');
  return frac ? `${s.slice(0, -dec)}.${frac}` : s.slice(0, -dec);
}
