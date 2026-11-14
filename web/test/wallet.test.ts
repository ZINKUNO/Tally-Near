import { it, expect } from "vitest";
import { call, setFrozen } from "../lib/tally";
import { TALLY } from "../lib/chain";

/** A stub NEAR wallet: records what it was asked to sign and returns a successful outcome. */
function stubWallet(value: unknown = null) {
  const sent: { receiverId: string; actions: { type: string; params: Record<string, unknown> }[] }[] = [];
  const wallet = {
    signAndSendTransaction: async (p: (typeof sent)[number]) => {
      sent.push(p);
      return { status: { SuccessValue: value === null ? "" : btoa(JSON.stringify(value)) }, transaction: { hash: "H" } };
    },
  };
  return { wallet, sent };
}

it("owner calls go to the connected wallet, not a local key", async () => {
  const { wallet, sent } = stubWallet({ status: "paid", receipt_id: 3 });
  const r = await call({ accountId: "alice.testnet", address: "alice.testnet", secret: "" as never, wallet }, TALLY, "approve", { pending_id: 1 });
  expect(r).toEqual({ hash: "H", value: { status: "paid", receipt_id: 3 } });
  expect(sent[0].receiverId).toBe(TALLY);
  expect(sent[0].actions[0]).toMatchObject({ type: "FunctionCall", params: { methodName: "approve", args: { pending_id: 1 }, deposit: "0" } });
});

it("freeze is a wallet-signed call", async () => {
  const { wallet, sent } = stubWallet();
  await setFrozen({ accountId: "alice.testnet", address: "alice.testnet", secret: "" as never, wallet }, "alice.testnet", true);
  expect(sent[0].actions[0].params.methodName).toBe("freeze");
});

it("a wallet failure surfaces as an error", async () => {
  const wallet = { signAndSendTransaction: async () => ({ status: { Failure: { ActionError: "x" } }, transaction: { hash: "H" } }) };
  await expect(call({ address: "a.testnet", secret: "" as never, wallet }, TALLY, "freeze", {})).rejects.toThrow(/ActionError/);
});
