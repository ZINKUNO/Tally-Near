# @tally-near/sdk

TypeScript for Tally on NEAR. Byte-identical to the contract (tested against `fixtures/vectors.json`).

```ts
import { signMenu, payArgs, verifyMenu, TallyClient, AgentWallet, checkCounterparty } from '@tally-near/sdk';

// merchant: sign a 5-minute menu
const menu = signMenu({ contractId: 'tallynear.testnet', merchantId: 'cafe.testnet', secret: menuKey, nonce: Date.now(),
  lines: [{ sku: 'flat-white', name: 'Flat white', category: 3, price: 4_500_000n }] });

// anyone: views over public RPC (fails over between providers)
const client = new TallyClient('tallynear.testnet');
await client.assess('cafe.testnet', 'alice.testnet');        // Guard verdict
await client.previewPay('alice.testnet', payArgs(menu, 0));  // what pay would do

// agent: pay with the function-call key on the owner's account
const { outcome } = await new AgentWallet(client, 'alice.testnet', agentKey).pay(payArgs(menu, 0));
```

`checkCounterparty` adds agent-side signals (payout account exists, age, contract code-hash pins,
history) to the contract's verdict and returns `sign`, `ask_human` or `refuse`.

Also: `signPayDelegate` / `checkPayDelegate` (NEP-366 gasless pay), `verifyPortable` (Chain Signatures
receipts), `depositRequest` (NEAR Intents deposits).

Tests: `pnpm test` (17).
