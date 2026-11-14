/**
 * NEAR AI Cloud gateway attestation, verified.
 *
 * Before planning, the agent asks the NEAR AI Cloud gateway for an Intel TDX quote bound to a fresh
 * 32-byte nonce, then (the same checks as github.com/nearai/nearai-cloud-verifier):
 *
 *   1. verifies the quote with Intel's DCAP collateral (`@phala/dcap-qvl`, incl. QE identity): status must be
 *      `UpToDate` or `OutOfDate` (valid quote crypto, TCB advisory only)
 *   2. reads `report_data` from the *verified* quote, not the HTTP echo:
 *        report_data[0..32]  == the gateway's signing address (padded)
 *        report_data[32..64] == our nonce
 *
 * The receipt's `attestation` field records the result:
 *   nearai-tdx:<status>:<sha256(quote)[:16]>:<nonce[:16]>   verified
 *   nearai-gw:<sha256(quote)[:32]>:<nonce[:16]>             only fetched (verification unavailable)
 */
import { createHash, randomBytes } from 'node:crypto';

export type Attestation = {
  digest: string;
  signingAddress: string;
  nonce: string;
  label: string;
  verified: boolean;
  status?: string;
  bindsAddress?: boolean;
  bindsNonce?: boolean;
};

type Report = { intel_quote?: string; request_nonce?: string; signing_address?: string; signing_algo?: string };

const OK = new Set(['UpToDate', 'OutOfDate']);

/** report_data checks against a verified quote's report_data (hex). */
export function checkBindings(reportDataHex: string, signingAddress: string, nonce: string): { bindsAddress: boolean; bindsNonce: boolean } {
  const rd = Buffer.from(reportDataHex.replace(/^0x/i, ''), 'hex');
  const addr = Buffer.from(signingAddress.replace(/^0x/i, ''), 'hex');
  const padded = Buffer.concat([addr, Buffer.alloc(Math.max(0, 32 - addr.length))]);
  return {
    bindsAddress: addr.length > 0 && addr.length <= 32 && rd.subarray(0, 32).equals(padded),
    bindsNonce: rd.length >= 64 && rd.subarray(32, 64).equals(Buffer.from(nonce, 'hex')),
  };
}

/** Finds the 64-byte `reportData` inside a verified report (TD10 / TD15 / SGX shapes differ). */
function findReportData(o: unknown, depth = 0): Uint8Array | null {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  const r = o as Record<string, unknown>;
  if (r.reportData instanceof Uint8Array) return r.reportData;
  for (const v of Object.values(r)) {
    const f = findReportData(v, depth + 1);
    if (f) return f;
  }
  return null;
}

/**
 * DCAP-verify a TDX quote with `@phala/dcap-qvl` (pure JS: PCK chain, TCB info and QE identity checks)
 * against collateral from Intel's PCS. Returns status and report_data, or null if verification failed.
 */
export async function verifyQuote(quoteHex: string): Promise<{ status: string; reportData: string } | null> {
  try {
    const { getCollateralAndVerify, INTEL_PCS_URL } = (await import('@phala/dcap-qvl')) as unknown as {
      getCollateralAndVerify(q: Uint8Array, pccs?: string): Promise<{ status: string; report: unknown }>;
      INTEL_PCS_URL: string;
    };
    const v = await getCollateralAndVerify(Buffer.from(quoteHex, 'hex'), INTEL_PCS_URL);
    const rd = findReportData(v.report);
    return { status: v.status, reportData: rd ? Buffer.from(rd).toString('hex') : '' };
  } catch {
    return null;
  }
}

export async function gatewayAttestation(fetchImpl: typeof fetch = fetch, verify = verifyQuote): Promise<Attestation | null> {
  const nonce = randomBytes(32).toString('hex');
  let g: Report | undefined;
  try {
    const r = await fetchImpl(`https://cloud-api.near.ai/v1/attestation/report?signing_algo=ed25519&nonce=${nonce}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    g = ((await r.json()) as { gateway_attestation?: Report }).gateway_attestation;
  } catch {
    return null;
  }
  if (!g?.intel_quote || g.request_nonce !== nonce) return null;
  const digest = createHash('sha256').update(g.intel_quote).digest('hex');
  const base = { digest, signingAddress: g.signing_address ?? '', nonce };
  const v = await verify(g.intel_quote);
  if (v) {
    const b = checkBindings(v.reportData, base.signingAddress, nonce);
    const verified = OK.has(v.status) && b.bindsAddress && b.bindsNonce;
    if (verified) {
      return { ...base, verified, status: v.status, ...b, label: `nearai-tdx:${v.status}:${digest.slice(0, 16)}:${nonce.slice(0, 16)}` };
    }
    return { ...base, verified: false, status: v.status, ...b, label: `nearai-gw:${digest.slice(0, 32)}:${nonce.slice(0, 16)}` };
  }
  return { ...base, verified: false, label: `nearai-gw:${digest.slice(0, 32)}:${nonce.slice(0, 16)}` };
}
