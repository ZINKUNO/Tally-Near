/**
 * Demo environment: account names from PREFIX, full-access keys from the NEAR CLI legacy
 * keychain (~/.near-credentials), and demo-only keys (merchant menu keys, the agent's
 * function-call key) in ~/.tally/<prefix>/keys.json. Nothing secret is ever written to the repo.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, KeyPair, KeyPairSigner, type KeyPairString } from 'near-api-js';
import { TallyClient, RPC } from '@tally-near/sdk';

export const PREFIX = process.env.PREFIX ?? 'tallynear';
export const NETWORK = 'testnet' as const;
export const ids = {
  contract: process.env.CONTRACT ?? `${PREFIX}.testnet`,
  token: `${PREFIX}-usdc.testnet`,
  arbiter: `${PREFIX}-arbiter.testnet`,
  owner: `${PREFIX}-alice.testnet`,
  owner2: `${PREFIX}-bob.testnet`,
  merchant: `${PREFIX}-cafe.testnet`,
  shady: `${PREFIX}-shady.testnet`,
};

export const client = new TallyClient(ids.contract, process.env.NEAR_RPC ?? RPC.testnet);

/** Full-access account from the NEAR CLI keychain. Picks the stored key that is live on chain. */
export function fullAccess(accountId: string): Account {
  const dir = join(homedir(), '.near-credentials', NETWORK);
  const files = [join(dir, `${accountId}.json`)];
  if (existsSync(join(dir, accountId))) files.push(...readdirSync(join(dir, accountId)).map((f) => join(dir, accountId, f)));
  const stored = files.filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8')) as { public_key: string; private_key: string });
  if (!stored.length) throw new Error(`no key for ${accountId} in ~/.near-credentials (run scripts/deploy.sh)`);
  const live = liveKeys.get(accountId);
  const pick = (live && stored.find((k) => live.includes(k.public_key))) ?? stored[0];
  return new Account(accountId, client.provider, KeyPairSigner.fromSecretKey(pick.private_key as KeyPairString));
}

const liveKeys = new Map<string, string[]>();
/** Load on-chain access keys for these accounts so `fullAccess` can pick the right stored key. */
export async function loadLiveKeys(accountIds: string[]) {
  for (const accountId of accountIds) {
    const r = (await client.provider.viewAccessKeyList({ accountId } as any).catch(() => ({ keys: [] }))) as any;
    liveKeys.set(accountId, r.keys.map((k: any) => k.public_key));
  }
}

type DemoKeys = { agent: KeyPairString; cafeMenu: KeyPairString; shadyMenu: KeyPairString };

const keyFile = join(homedir(), '.tally', PREFIX, 'keys.json');

/** Demo keys, generated once. The agent key here is the function-call key added to the owner. */
export function demoKeys(): DemoKeys {
  if (process.env.TALLY_AGENT_KEY && process.env.TALLY_MENU_KEY) {
    return { agent: process.env.TALLY_AGENT_KEY as KeyPairString, cafeMenu: process.env.TALLY_MENU_KEY as KeyPairString, shadyMenu: process.env.TALLY_MENU_KEY as KeyPairString };
  }
  if (existsSync(keyFile)) return JSON.parse(readFileSync(keyFile, 'utf8'));
  mkdirSync(join(homedir(), '.tally', PREFIX), { recursive: true });
  const k: DemoKeys = {
    agent: KeyPair.fromRandom('ed25519').toString() as KeyPairString,
    cafeMenu: KeyPair.fromRandom('ed25519').toString() as KeyPairString,
    shadyMenu: KeyPair.fromRandom('ed25519').toString() as KeyPairString,
  };
  writeFileSync(keyFile, JSON.stringify(k, null, 2), { mode: 0o600 });
  return k;
}

export const pub = (k: KeyPairString) => KeyPair.fromString(k).getPublicKey().toString();

export const TGAS = 1_000_000_000_000n;
export const YOCTO_PER_NEAR = 10n ** 24n;
export const near = (n: number) => (BigInt(Math.round(n * 1000)) * YOCTO_PER_NEAR) / 1000n;

/** Colour-free log lines that read well in a terminal and in a pasted markdown block. */
export const log = (tag: string, msg: string) => console.log(`${tag.padEnd(9)} ${msg}`);
