/**
 * Server side: NEAR AI Cloud gateway attestation bound to a fresh nonce. The agent route returns its
 * digest with each pick, and the app writes it into the purchase receipt on-chain. A binding and a
 * nonce check, not a DCAP verification (see ARCHITECTURE.md).
 */
import { createHash, randomBytes } from "node:crypto";

export async function gatewayAttestation(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const nonce = randomBytes(32).toString("hex");
  try {
    const r = await fetchImpl(`https://cloud-api.near.ai/v1/attestation/report?signing_algo=ed25519&nonce=${nonce}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const g = ((await r.json()) as { gateway_attestation?: { intel_quote?: string; request_nonce?: string } }).gateway_attestation;
    if (!g?.intel_quote || g.request_nonce !== nonce) return null;
    return `nearai-gw:${createHash("sha256").update(g.intel_quote).digest("hex").slice(0, 32)}:${nonce.slice(0, 16)}`;
  } catch {
    return null;
  }
}
