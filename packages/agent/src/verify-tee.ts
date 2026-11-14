/** Fetch and fully verify the NEAR AI Cloud gateway's TDX attestation once, printing each check. */
import { gatewayAttestation } from './attestation.ts';

const a = await gatewayAttestation();
if (!a) {
  console.log('gateway attestation unavailable');
  process.exit(1);
}
console.log(`nonce            ${a.nonce}`);
console.log(`signing address  ${a.signingAddress}`);
console.log(`quote sha256     ${a.digest}`);
console.log(`Intel DCAP       ${a.status ?? 'not run'}`);
console.log(`binds address    ${a.bindsAddress}`);
console.log(`binds our nonce  ${a.bindsNonce}`);
console.log(`VERIFIED         ${a.verified}   receipt label: ${a.label}`);
process.exit(a.verified ? 0 : 2);
