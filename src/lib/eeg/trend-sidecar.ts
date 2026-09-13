// The trends sidecar: a ViewerTrends serialised next to the recording it was
// computed from (`<recording>.trends.bin`), written once by the export worker
// (tools/trend-sidecar) and read by the viewer instead of walking the whole
// record again. The trends depend only on the recording bytes and the engine,
// so the file is as immutable as the recording; TREND_ENGINE_VERSION in the
// header says which engine wrote it, and a mismatch is treated as "no sidecar".
//
// Layout (little-endian):
//   "PQTR"  4 bytes magic
//   uint32  header length in bytes (padded to a multiple of 4)
//   JSON    header (utf-8)
//   float32 arrays, in ARRAY_ORDER, back to back
//
// Pure functions; no DOM, no fs — shared by the Node tool and the browser.

import { TREND_ENGINE_VERSION, type Side, type ViewerTrends } from "./trends";

export const TREND_SIDECAR_EXT = ".trends.bin";
const MAGIC = "PQTR";
const FORMAT = 1;

type ArrayKey = `${"psd" | "aeegLo" | "aeegHi" | "sr" | "adr" | "totalPower"}.${Side}` | "asym" | "t";
const ARRAY_ORDER: ArrayKey[] = [
  "psd.left", "psd.right", "aeegLo.left", "aeegLo.right", "aeegHi.left", "aeegHi.right",
  "sr.left", "sr.right", "adr.left", "adr.right", "totalPower.left", "totalPower.right", "asym", "t",
];

export interface TrendSidecarHeader {
  magic: string;
  format: number;
  engineVersion: number;
  hopS: number;
  nT: number;
  nF: number;
  filled: number;
  freqs: number[];
  aeegDerivation: Record<Side, string>;
  durationS: number;
  sampleRate: number;
  channels: number;
  createdAt: string;
  arrays: string[];
}

function pick(t: ViewerTrends, key: ArrayKey): Float32Array {
  if (key === "asym" || key === "t") return t[key];
  const [name, side] = key.split(".") as [Exclude<ArrayKey, "asym" | "t"> extends `${infer N}.${string}` ? N : never, Side];
  return (t as unknown as Record<string, Record<Side, Float32Array>>)[name][side];
}

export function encodeTrends(t: ViewerTrends, meta: { durationS: number; sampleRate: number; channels: number }): ArrayBuffer {
  const header: TrendSidecarHeader = {
    magic: MAGIC, format: FORMAT, engineVersion: TREND_ENGINE_VERSION,
    hopS: t.hopS, nT: t.nT, nF: t.freqs.length, filled: t.filled, freqs: Array.from(t.freqs),
    aeegDerivation: t.aeegDerivation, durationS: meta.durationS, sampleRate: meta.sampleRate, channels: meta.channels,
    createdAt: new Date().toISOString(), arrays: ARRAY_ORDER,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const headerLen = Math.ceil(headerBytes.length / 4) * 4;
  const arrays = ARRAY_ORDER.map((k) => pick(t, k));
  const total = 8 + headerLen + arrays.reduce((s, a) => s + a.byteLength, 0);
  const buf = new ArrayBuffer(total);
  const u8 = new Uint8Array(buf);
  u8.set([0x50, 0x51, 0x54, 0x52], 0); // PQTR
  new DataView(buf).setUint32(4, headerLen, true);
  u8.set(headerBytes, 8);
  let off = 8 + headerLen;
  for (const a of arrays) {
    u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), off);
    off += a.byteLength;
  }
  return buf;
}

/** Header only (cheap check before committing to the arrays). */
export function readTrendSidecarHeader(buf: ArrayBuffer): TrendSidecarHeader | null {
  if (buf.byteLength < 8) return null;
  const u8 = new Uint8Array(buf);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) return null;
  const headerLen = new DataView(buf).getUint32(4, true);
  if (8 + headerLen > buf.byteLength) return null;
  try {
    const text = new TextDecoder().decode(u8.subarray(8, 8 + headerLen)).replace(/\0+$/, "");
    const h = JSON.parse(text) as TrendSidecarHeader;
    return h && h.magic === MAGIC && h.format === FORMAT ? h : null;
  } catch {
    return null;
  }
}

/**
 * Decode a sidecar for a recording of `expect.durationS` seconds. Returns null
 * when the file is not a sidecar, was written by another engine version, or
 * does not describe this recording — the caller then falls back to computing.
 */
export function decodeTrends(buf: ArrayBuffer, expect: { durationS: number }): ViewerTrends | null {
  const h = readTrendSidecarHeader(buf);
  if (!h || h.engineVersion !== TREND_ENGINE_VERSION) return null;
  if (Math.abs(h.durationS - expect.durationS) > 1) return null;
  if (!Array.isArray(h.arrays) || h.arrays.join() !== ARRAY_ORDER.join()) return null;
  const headerLen = new DataView(buf).getUint32(4, true);
  let off = 8 + headerLen;
  const take = (n: number): Float32Array | null => {
    const bytes = n * 4;
    if (off + bytes > buf.byteLength) return null;
    // copy so the result is a plain, aligned Float32Array whatever the source buffer
    const out = new Float32Array(buf.slice(off, off + bytes));
    off += bytes;
    return out;
  };
  const nT = h.nT, nF = h.nF;
  const side = (n: number): Record<Side, Float32Array> | null => {
    const l = take(n), r = take(n);
    return l && r ? { left: l, right: r } : null;
  };
  const psd = side(nF * nT), aeegLo = side(nT), aeegHi = side(nT), sr = side(nT), adr = side(nT), totalPower = side(nT);
  const asym = take(nT), t = take(nT);
  if (!psd || !aeegLo || !aeegHi || !sr || !adr || !totalPower || !asym || !t) return null;
  return {
    hopS: h.hopS, t, nT, freqs: Float32Array.from(h.freqs),
    psd, aeegLo, aeegHi, sr, adr, totalPower, asym,
    filled: h.filled, aeegDerivation: h.aeegDerivation,
  };
}
