"use client";
/**
 * NEAR wallet sign-in (HOT near-connect: HOT, Meteor, MyNearWallet, Intear…) for people who already have a
 * NEAR account. The wallet signs every owner action; the app only holds the agent's pay-only key and the
 * menu key, generated in this browser and kept in localStorage.
 */
import type { ConnectorAction, NearConnector } from "@hot-labs/near-connect";
import { KeyPair, type KeyPairString } from "near-api-js";
import { NETWORK, RPC } from "./chain";
import type { Keys } from "./passkey";

export type WalletLike = { signAndSendTransaction(p: { receiverId: string; actions: ConnectorAction[] }): Promise<unknown> };

let connector: Promise<NearConnector> | undefined;
function getConnector() {
  connector ??= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: NETWORK, providers: { [NETWORK]: RPC.split(",") } } as never));
  return connector;
}

function localKey(accountId: string, role: string): { publicKey: string; secret: KeyPairString } {
  const k = `tally.wallet.${accountId}.${role}`;
  let secret = localStorage.getItem(k) as KeyPairString | null;
  if (!secret) {
    secret = KeyPair.fromRandom("ed25519").toString() as KeyPairString;
    localStorage.setItem(k, secret);
  }
  return { publicKey: KeyPair.fromString(secret).getPublicKey().toString(), secret };
}

function keysFor(accountId: string, wallet: WalletLike): Keys {
  const agent = localKey(accountId, "agent");
  const merchant = localKey(accountId, "merchant");
  return {
    owner: { accountId, address: accountId, publicKey: "", secret: "" as KeyPairString, wallet },
    agent: { address: agent.publicKey, ...agent },
    merchant: { address: merchant.publicKey, ...merchant },
    end: () => {},
  };
}

export async function connectWallet(): Promise<Keys> {
  const c = await getConnector();
  const wallet = await c.connect();
  const accountId = (await wallet.getAccounts())[0]?.accountId;
  if (!accountId) throw new Error("no account");
  localStorage.setItem("tally.session", "wallet");
  return keysFor(accountId, wallet as unknown as WalletLike);
}

/** Restores a wallet session after a reload. */
export async function restoreWallet(): Promise<Keys | null> {
  if (localStorage.getItem("tally.session") !== "wallet") return null;
  const c = await getConnector();
  const connected = await c.getConnectedWallet().catch(() => null);
  const accountId = connected?.accounts[0]?.accountId;
  return accountId ? keysFor(accountId, connected!.wallet as unknown as WalletLike) : null;
}

export async function disconnectWallet() {
  localStorage.removeItem("tally.session");
  const c = await getConnector();
  const connected = await c.getConnectedWallet().catch(() => null);
  if (connected) await c.disconnect(connected.wallet).catch(() => {});
}
