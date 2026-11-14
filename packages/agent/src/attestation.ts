/**
 * NEAR AI Cloud gateway attestation. Before planning, the agent asks the gateway for a TDX quote
 * bound to a fresh 32-byte nonce, checks the nonce echo, and records a digest of the quote in the
 * purchase receipt's `attestation` field. The owner (or anyone) can later verify the full quote
 * with NEAR AI's verifier; the receipt pins which evidence the agent ran under.
 *
 * Scope: this is a binding and a consistency check, not a DCAP verification. Full verification
 * (Intel DCAP quote, RTMR3 replay, MRCONFIGID) is what https://docs.near.ai/cloud/verification
 * describes and is out of scope for the agent's hot path.
 */
import { randomBytes, createHash } from 'node:crypto';

export type Attestation = { digest: string; signingAddress: string; nonce: string; label: string };

export async function gatewayAttestation(fetchImpl: typeof fetch = fetch): Promise<Attestation | null> {
  const nonce = randomBytes(32).toString('hex');
  try {
    const r = await fetchImpl(`https://cloud-api.near.ai/v1/attestation/report?signing_algo=ed25519&nonce=${nonce}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { gateway_attestation?: { intel_quote?: string; request_nonce?: string; signing_address?: string } };
    const g = j.gateway_attestation;
    if (!g?.intel_quote || g.request_nonce !== nonce) return null;
    const digest = createHash('sha256').update(g.intel_quote).digest('hex');
    return { digest, signingAddress: g.signing_address ?? '', nonce, label: `nearai-gw:${digest.slice(0, 32)}:${nonce.slice(0, 16)}` };
  } catch {
    return null;
  }
}
