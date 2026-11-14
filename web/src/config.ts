export const NETWORK = (import.meta.env.VITE_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
export const CONTRACT = import.meta.env.VITE_CONTRACT ?? 'tallynear.testnet';
export const TOKEN = import.meta.env.VITE_TOKEN ?? 'tallynear-usdc.testnet';
/** Capsule shown before anyone connects a wallet: the live demo owner. */
export const DEMO_OWNER = import.meta.env.VITE_DEMO_OWNER ?? 'tallynear-alice.testnet';
export const RPCS = NETWORK === 'testnet'
  ? 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org'
  : 'https://free.rpc.fastnear.com,https://near.drpc.org';
export const CATEGORY_NAMES: Record<number, string> = { 1: 'Coffee', 2: 'Pastry', 3: 'Merch' };
export const REPO = 'https://github.com/ZINKUNO/Tally-Near';
