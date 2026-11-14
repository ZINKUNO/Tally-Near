import { TallyClient } from "@tally-near/sdk";
import d from "./deployments.json";

export const NETWORK = d.network as "testnet" | "mainnet";
export const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://test.rpc.fastnear.com,https://near-testnet.drpc.org";
/** Views and transactions go through public RPC, failing over between providers. */
export const client = new TallyClient(d.tally, RPC);
export const provider = client.provider;
export const TALLY = d.tally;
export const TOKEN = d.token;
export const DEMO_MERCHANT = d.demoMerchant;
export const EXPLORER = NETWORK === "testnet" ? "https://testnet.nearblocks.io" : "https://nearblocks.io";

export const TGAS = 1_000_000_000_000n;
export const YOCTO = 10n ** 24n;

/** Link to a transaction, or to the account when only the on-chain receipt is known. */
export const txUrl = (hash?: string, account?: string) => (hash ? `${EXPLORER}/txns/${hash}` : `${EXPLORER}/address/${account ?? TALLY}`);
