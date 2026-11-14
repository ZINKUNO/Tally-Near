import { it, expect } from "vitest";
import { gatewayAttestation } from "../lib/attestation";

it("pins a quote digest only when the gateway echoes our nonce", async () => {
  const echo = (async (url: string) => ({
    ok: true,
    json: async () => ({ gateway_attestation: { intel_quote: "abcd", request_nonce: new URL(url).searchParams.get("nonce") } }),
  })) as never;
  expect(await gatewayAttestation(echo)).toMatch(/^nearai-gw:[0-9a-f]{32}:[0-9a-f]{16}$/);
  const stale = (async () => ({ ok: true, json: async () => ({ gateway_attestation: { intel_quote: "abcd", request_nonce: "00" } }) })) as never;
  expect(await gatewayAttestation(stale)).toBeNull();
  const down = (async () => ({ ok: false })) as never;
  expect(await gatewayAttestation(down)).toBeNull();
});
