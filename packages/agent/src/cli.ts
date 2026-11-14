#!/usr/bin/env -S node --experimental-strip-types
/**
 * tally-buy "<goal>" [--menu <url|file>] [--yes]
 * Buys one item for the capsule owner with the agent's function-call key and prints each step.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { explorerTx } from '@tally-near/sdk';
import { buy } from './agent.ts';
import { agentConfig } from './config.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const yes = argv.includes('--yes') ? (argv.splice(argv.indexOf('--yes'), 1), true) : false;
const cfg = agentConfig();
const menuArg = flag('--menu') ?? `${cfg.menuBase}/menu/cafe`;
const goal = argv.join(' ') || 'a coffee';
if (!cfg.agentKey) throw new Error('set TALLY_AGENT_KEY (the function-call key) or run the demo seed first');

const menu = existsSync(menuArg) ? readFileSync(menuArg, 'utf8') : menuArg;
const res = await buy({
  goal, menu, client: cfg.client, ownerId: cfg.ownerId, agentKey: cfg.agentKey, minAccountAgeMs: cfg.minAccountAgeMs, relayUrl: cfg.relayUrl,
  askHuman: async (q) => {
    if (yes) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`${q}\nContinue? [y/N] `);
    rl.close();
    return a.trim().toLowerCase() === 'y';
  },
});
for (const s of res.steps) console.log(`${s.ok ? '✔' : '✘'} ${s.step.padEnd(22)} ${s.detail}`);
console.log(`\n${res.status.toUpperCase()}${res.item ? ` — ${res.item.name}` : ''}`);
if (res.txHash) console.log(explorerTx(res.txHash));
