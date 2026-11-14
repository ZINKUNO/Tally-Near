/**
 * One passkey, three NEAR keys. A WebAuthn passkey with the PRF extension returns the same 32 secret
 * bytes every time the user unlocks it with Face ID or a fingerprint; Tally derives three ed25519 keys:
 *
 *   owner     full-access key of the user's NEAR implicit account (account id = hex of its public key)
 *   agent     a function-call key on that same account, allowed to call only Tally's `pay`
 *   merchant  the menu signing key, if the user runs a counter
 *
 * Nothing is stored except the credential id, so the keys exist only while the app is unlocked.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { KeyPair, type KeyPairString } from "near-api-js";
import { toBase58 } from "@tally-near/sdk";

const CRED_KEY = "tally.credential";
const SALT = new TextEncoder().encode("tally-near/prf/v1");

export type NearKey = {
  /** For the owner: the implicit account id. For agent and merchant: the `ed25519:` public key. */
  address: string;
  publicKey: string;
  secret: KeyPairString;
};
export type Keys = { owner: NearKey & { accountId: string }; agent: NearKey; merchant: NearKey; end(): void };

function keyFrom(seed: Uint8Array): { publicKey: string; secret: KeyPairString; raw: Uint8Array } {
  const pub = ed25519.getPublicKey(seed);
  const full = new Uint8Array(64);
  full.set(seed);
  full.set(pub, 32);
  const secret = `ed25519:${toBase58(full)}` as KeyPairString;
  return { publicKey: KeyPair.fromString(secret).getPublicKey().toString(), secret, raw: pub };
}

/** Same derivation everywhere (tested): sha256(prf || label). */
export function deriveKeys(prf: Uint8Array): Keys {
  const label = (l: string) => sha256(new Uint8Array([...prf, ...new TextEncoder().encode(l)]));
  const o = keyFrom(label("owner"));
  const a = keyFrom(label("agent"));
  const m = keyFrom(label("merchant"));
  const accountId = Array.from(o.raw, (b) => b.toString(16).padStart(2, "0")).join("");
  return {
    owner: { accountId, address: accountId, publicKey: o.publicKey, secret: o.secret },
    agent: { address: a.publicKey, publicKey: a.publicKey, secret: a.secret },
    merchant: { address: m.publicKey, publicKey: m.publicKey, secret: m.secret },
    end: () => {},
  };
}

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

class PasskeyError extends Error {
  constructor(public code: "PRF_UNAVAILABLE" | "PASSKEY_OPERATION_FAILED", message: string) {
    super(message);
  }
}

function prfOf(cred: PublicKeyCredential | null): Uint8Array {
  const r = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined)?.prf?.results?.first;
  if (!r) throw new PasskeyError("PRF_UNAVAILABLE", "This passkey does not support PRF");
  return new Uint8Array(r);
}

async function getPrf(credentialId?: string): Promise<{ prf: Uint8Array; id: string }> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        userVerification: "required",
        allowCredentials: credentialId ? [{ type: "public-key", id: unb64u(credentialId) }] : [],
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new PasskeyError("PASSKEY_OPERATION_FAILED", (e as Error).message);
  }
  return { prf: prfOf(cred), id: b64u(cred!.rawId) };
}

export function hasSavedPasskey(): boolean {
  try {
    return !!localStorage.getItem(CRED_KEY);
  } catch {
    return false;
  }
}

export async function signUp(displayName: string): Promise<Keys> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: location.hostname, name: "Tally" },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: displayName, displayName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        extensions: { prf: { eval: { first: SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw new PasskeyError("PASSKEY_OPERATION_FAILED", (e as Error).message);
  }
  const id = b64u(cred!.rawId);
  localStorage.setItem(CRED_KEY, JSON.stringify({ credentialId: id }));
  // Some authenticators only return PRF on assertion, not on creation.
  const direct = (cred?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  return deriveKeys(direct ? new Uint8Array(direct) : (await getPrf(id)).prf);
}

export async function signIn(): Promise<Keys> {
  const saved = localStorage.getItem(CRED_KEY);
  const { prf, id } = await getPrf(saved ? JSON.parse(saved).credentialId : undefined);
  if (!saved) localStorage.setItem(CRED_KEY, JSON.stringify({ credentialId: id }));
  return deriveKeys(prf);
}

export function forgetPasskey() {
  localStorage.removeItem(CRED_KEY);
}

export function friendlyPasskeyError(e: unknown): string {
  if (e instanceof PasskeyError) {
    if (e.code === "PRF_UNAVAILABLE")
      return "This device can't use Tally's Face ID sign-in. Open Tally on your phone, or save the passkey in Google Password Manager or iCloud Keychain.";
    return "Face ID or fingerprint was cancelled. Try again.";
  }
  return "Something went wrong signing in. Try again.";
}
