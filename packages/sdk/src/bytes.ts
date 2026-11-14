/** Small byte helpers shared by the SDK. No dependencies beyond @noble. */
import { sha256 } from '@noble/hashes/sha256';

export const enc = new TextEncoder();

export function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function unhex(s: string, len?: number): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error(`not hex: ${s.slice(0, 20)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  if (len !== undefined && out.length !== len) throw new Error(`expected ${len} bytes, got ${out.length}`);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const sha = (...parts: Uint8Array[]) => sha256(concat(...parts));

export function le(value: bigint, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  let v = value;
  for (let i = 0; i < bytes; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`${value} does not fit in ${bytes} bytes`);
  return out;
}

export function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
