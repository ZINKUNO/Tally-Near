/**
 * Live end to end on NEAR testnet, exactly the calls the screens make. Skipped unless LIVE=1 and the
 * sponsor + demo counter secrets are in the environment (see .env.example).
 *   LIVE=1 npx vitest run test/e2e.live.test.ts
 */
import { describe, it, expect } from "vitest";
import { client } from "../lib/chain";
import { buildAttacks } from "../lib/attacks";
import { DEMO_ITEMS, signMenu } from "../lib/counter";
import { decodeQr, payArgs } from "../lib/menu";
import { deriveKeys } from "../lib/passkey";
import { pay } from "../lib/pay";
import { chainNow, createAllowance, fundAllowance, readCapsule, rulesFromForm, usdBalance } from "../lib/tally";

const live = process.env.LIVE === "1" && !!process.env.SPONSOR_KEY && !!process.env.DEMO_MERCHANT_SIGNER_KEY;
const fresh = () => deriveKeys(crypto.getRandomValues(new Uint8Array(32)));

async function onboard(owner: string) {
  const { POST } = await import("../app/api/onboard/route");
  const r = await POST(new Request("http://x/api/onboard", { method: "POST", body: JSON.stringify({ owner }) }));
  expect(r.status).toBe(200);
}
async function demoMenu() {
  const { GET } = await import("../app/api/counter/route");
  return decodeQr((await (await GET()).json()).qr);
}

describe.skipIf(!live)("live on testnet", () => {
  const me = fresh();
  const id = me.owner.accountId;

  it("a new Face ID user gets a funded NEAR account and opens an allowance with a pay-only agent key", async () => {
    await onboard(id);
    expect(await usdBalance(id)).toBe(50_000_000n);
    const rules = rulesFromForm({ categories: [0, 1, 3, 8], perPurchase: 10, daily: 25, days: 30, nowSec: Number(await chainNow()) });
    await createAllowance(me.owner, me.agent.publicKey, rules, 20_000_000n);
    const c = await readCapsule(id);
    expect(c?.balance).toBe(20_000_000n);
    expect(c?.agent).toBe(me.agent.publicKey);
  }, 120_000);

  it("the agent pays the cheapest coffee on its own", async () => {
    const m = await demoMenu();
    const r = await pay(me.agent, null, id, m, m.items[0], { memo: "a coffee" });
    expect(r.cosigned).toBe(false);
    expect((await client.receipts(id))[0].price).toBe("4500000");
  }, 120_000);

  it("a pricier pick waits for the owner, then pays co-signed", async () => {
    const m = await demoMenu();
    const r = await pay(me.agent, me.owner, id, m, m.items[1]);
    expect(r.cosigned).toBe(true);
  }, 120_000);

  it("family tops up the allowance from their own account", async () => {
    const mum = fresh();
    await onboard(mum.owner.accountId);
    const before = (await readCapsule(id))!.balance;
    await fundAllowance(mum.owner, id, 5_000_000n, "For lunches");
    const c = (await readCapsule(id))!;
    expect(c.balance).toBe(before + 5_000_000n);
    expect(c.topups.at(-1)?.note).toBe("For lunches");
  }, 120_000);

  it("the contract refuses all four red-team attacks", async () => {
    const m = await demoMenu();
    const forged = await signMenu(me.merchant, m.header.merchant, DEMO_ITEMS, Number(await chainNow()), BigInt(Date.now()));
    const got = [];
    for (const a of buildAttacks(m, forged)) {
      const p = await client.previewPay(id, payArgs(a.menu, a.item, a.proof) as never);
      got.push(p.outcome === "rejected" ? p.code : p.outcome);
    }
    expect(got).toEqual(["bad_signature", "not_on_menu", "not_on_menu", "second_look"]);
  }, 120_000);
});
