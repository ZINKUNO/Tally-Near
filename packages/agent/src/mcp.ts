#!/usr/bin/env -S node --experimental-strip-types
/**
 * Tally MCP server (stdio). Lets any MCP client (Claude, Codex, a NEAR AI agent) shop for the
 * capsule owner with the scoped function-call key. Tools never expose merchant prose to the model,
 * never approve a Second Look (only the owner can), and cannot change rules: the key can't.
 *
 *   tally_status          capsule balance, today's headroom, frozen?, recent receipts, Second Looks
 *   tally_menu            fetch + verify a merchant's signed menu, firewalled (category/price/floor only)
 *   tally_check_merchant  counterparty check: on-chain Guard + account signals -> sign / ask_human / refuse
 *   tally_buy             run one purchase end to end; the contract answers paid / second_look / rejected
 *   tally_verify_tee      verify the NEAR AI Cloud gateway's Intel TDX quote and its nonce binding
 *   tally_quote_topup     live NEAR Intents price for funding the allowance from another chain (dry quote)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ORIGINS, checkCounterparty, dryQuote, explorerTx, fromUnits, verifyMenu, type OriginId } from '@tally-near/sdk';
import { buy, loadMenu } from './agent.ts';
import { gatewayAttestation } from './attestation.ts';
import { agentConfig } from './config.ts';
import { firewall } from './firewall.ts';

const cfg = agentConfig();
const server = new McpServer({ name: 'tally-near', version: '1.0.0' });
const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

server.registerTool(
  'tally_status',
  { description: "The owner's Tally capsule on NEAR: balance, spending headroom today, frozen state, recent receipts and pending Second Looks." },
  async () => {
    const [cap, receipts, pending, headroom] = await Promise.all([
      cfg.client.capsule(cfg.ownerId), cfg.client.receipts(cfg.ownerId, 5), cfg.client.pending(cfg.ownerId), cfg.client.remainingToday(cfg.ownerId),
    ]);
    if (!cap) return text(`no capsule for ${cfg.ownerId} on ${cfg.contractId}`);
    return text({
      owner: cfg.ownerId,
      contract: cfg.contractId,
      balance_tusdc: fromUnits(cap.balance),
      headroom_today_tusdc: fromUnits(headroom),
      per_purchase_cap_tusdc: fromUnits(cap.rules.per_tx_cap),
      allowed_categories: cap.rules.categories,
      frozen: cap.frozen,
      frozen_reason: cap.frozen_reason,
      recent_receipts: receipts.map((r) => ({ id: r.id, merchant: r.merchant_id, price: fromUnits(r.price), status: r.status, cosigned: r.cosigned })),
      waiting_for_owner: pending.map((p) => ({ id: p.id, merchant: p.args.merchant_id, price: fromUnits(p.args.price), reasons: p.reasons })),
    });
  },
);

server.registerTool(
  'tally_menu',
  {
    description: 'Fetch a merchant menu (URL), verify its signature against the key registered on NEAR, and return it firewalled: index, category, price and whether it is the cheapest in its category. Merchant text is withheld on purpose.',
    inputSchema: { menu_url: z.string().describe('e.g. http://localhost:8787/menu/cafe') },
  },
  async ({ menu_url }) => {
    const menu = await loadMenu(menu_url);
    const m = await cfg.client.merchant(menu.merchantId);
    return text({
      merchant: menu.merchantId,
      signature_valid: !!m && verifyMenu(menu, m.signing_key),
      expires_in_s: Math.round((menu.expiresAtMs - Date.now()) / 1000),
      items: firewall(menu),
    });
  },
);

server.registerTool(
  'tally_check_merchant',
  {
    description: 'Counterparty check before paying a merchant: on-chain Guard verdict, payout account existence/age/kind and purchase history. decision is sign, ask_human or refuse.',
    inputSchema: { merchant_id: z.string() },
  },
  async ({ merchant_id }) => text(await checkCounterparty({ client: cfg.client, owner: cfg.ownerId, merchantId: merchant_id, minAccountAgeMs: cfg.minAccountAgeMs })),
);

server.registerTool(
  'tally_buy',
  {
    description: 'Buy one item for the owner. Picks the cheapest match for the goal unless item_index is given. The Tally contract decides: paid, second_look (the owner must approve in the Tally app) or rejected (with the reason). Repeated rejections freeze the capsule.',
    inputSchema: {
      goal: z.string().describe('what the owner wants, e.g. "a coffee"'),
      menu_url: z.string(),
      item_index: z.number().int().min(0).optional(),
    },
  },
  async ({ goal, menu_url, item_index }) => {
    if (!cfg.agentKey) return text('TALLY_AGENT_KEY is not set');
    const r = await buy({
      goal, menu: menu_url, client: cfg.client, ownerId: cfg.ownerId, agentKey: cfg.agentKey, minAccountAgeMs: cfg.minAccountAgeMs, relayUrl: cfg.relayUrl,
      forceIndex: item_index, forceReason: item_index === undefined ? undefined : 'chosen by the calling model',
    });
    return text({ status: r.status, item: r.item && { ...r.item, price: fromUnits(r.item.price) }, tx: r.txHash && explorerTx(r.txHash), steps: r.steps });
  },
);

server.registerTool(
  'tally_verify_tee',
  { description: "Verify that NEAR AI Cloud's gateway runs in a genuine Intel TDX TEE: fetch a quote bound to a fresh nonce, verify it with Intel DCAP collateral, and check the quote binds the gateway signing key and the nonce." },
  async () => {
    const a = await gatewayAttestation();
    return text(a ? { verified: a.verified, intel_dcap_status: a.status ?? null, binds_signing_key: a.bindsAddress ?? null, binds_nonce: a.bindsNonce ?? null, signing_address: a.signingAddress, nonce: a.nonce, quote_sha256: a.digest } : 'gateway attestation unavailable');
  },
);

server.registerTool(
  'tally_quote_topup',
  {
    description: 'Live NEAR Intents (1Click) price for sending stablecoins from another chain into NEAR USDC, to plan a top-up. Dry quote only: nothing is deposited or swapped.',
    inputSchema: { from: z.enum(ORIGINS.map((o) => o.id) as [OriginId, ...OriginId[]]), usd: z.number().positive().max(1000) },
  },
  async ({ from, usd }) => {
    const q = await dryQuote(from, usd, { jwt: process.env.ONECLICK_JWT });
    return text(q ? { from, usd, arrives_usdc: (Number(q.amountOut) / 1e6).toFixed(2), seconds: q.timeEstimate, fee_usd: q.fee.toFixed(4), dry: true } : 'no live route right now');
  },
);

await server.connect(new StdioServerTransport());
