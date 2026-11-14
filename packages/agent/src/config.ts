/**
 * Agent configuration from the environment. The only secret is TALLY_AGENT_KEY, the function-call
 * key; without it the demo key file written by the seed script (~/.tally/<prefix>/keys.json) is used.
 */
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { TallyClient, RPC } from '@tally-near/sdk';
import type { KeyPairString } from 'near-api-js';

// Node gives each address family 250 ms by default, too short for slow links to some RPCs.
setDefaultAutoSelectFamilyAttemptTimeout(3000);

const PREFIX = process.env.PREFIX ?? 'tallynear';

export function agentConfig() {
  const contractId = process.env.TALLY_CONTRACT ?? `${PREFIX}.testnet`;
  const ownerId = process.env.TALLY_OWNER ?? `${PREFIX}-alice.testnet`;
  let agentKey = process.env.TALLY_AGENT_KEY as KeyPairString | undefined;
  const file = join(homedir(), '.tally', PREFIX, 'keys.json');
  if (!agentKey && existsSync(file)) agentKey = JSON.parse(readFileSync(file, 'utf8')).agent;
  const menuBase = process.env.TALLY_MENU_BASE ?? 'http://localhost:8787';
  const minAccountAgeMs = Number(process.env.TALLY_MIN_ACCOUNT_AGE_MS ?? 86_400_000);
  return { contractId, ownerId, agentKey, menuBase, minAccountAgeMs, client: new TallyClient(contractId, process.env.NEAR_RPC ?? RPC.testnet) };
}
