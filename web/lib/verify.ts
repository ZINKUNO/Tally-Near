import { ed25519 } from "@noble/curves/ed25519";
import { base58, unhex } from "@tally-near/sdk";
import { headerBytes, type SignedMenu } from "./menu";

/** True when the menu header was signed by `signingKey` (the `ed25519:` key the counter registered on-chain). */
export async function signedBy(m: SignedMenu, signingKey: string): Promise<boolean> {
  try {
    return ed25519.verify(unhex(m.sig, 64), headerBytes(m.header), base58(signingKey.replace(/^ed25519:/, "")));
  } catch {
    return false;
  }
}
