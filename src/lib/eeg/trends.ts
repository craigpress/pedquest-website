// qEEG trends computed in the browser from raw signal, one block at a time.
//
// A deliberately small subset of tools/eeg-render/eeg_render/trends.py,
// sharing its conventions (4 s Hann spectrogram to 20 Hz, hemispheric
// averaging, 0.5 s suppression epochs against a 3 µV threshold, aEEG on a
// central-parietal derivation) so a strip drawn here reads like the rendered
// panels. Pure functions, no DOM: the pane feeds it windows from EdfReader.

import { hemisphereChannels } from "./montage";
import { applyChain, designChain } from "./filters";

export const TREND_FMAX_HZ = 20;
export const TREND_WIN_S = 4;
export const SR_EPOCH_S = 0.5;
export const SR_WINDOW_S = 60;
export const SR_THRESHOLD_UV = 3;
export const AEEG_WINDOW_S = 15;

export type Side = "left" | "right";

export interface ViewerTrends {
  hopS: number;
  /** epoch centres, seconds */
  t: Float32Array;
  nT: number;
  freqs: Float32Array;
  /** spectrogram, row-major (nF × nT), µV²/Hz, per side */
  psd: Record<Side, Float32Array>;
  aeegLo: Record<Side, Float32Array>;
  aeegHi: Record<Side, Float32Array>;
  /** suppression ratio, % */
  sr: Record<Side, Float32Array>;
  /** alpha/delta ratio */
  adr: Record<Side, Float32Array>;
  /** total 1–20 Hz power, µV² */
  totalPower: Record<Side, Float32Array>;
  /** relative asymmetry, % (positive = right louder) */
  asym: Float32Array;
  /** how many epochs have been filled so far */
  filled: number;
  aeegDerivation: Record<Side, string>;
}

export function defaultHopS(durationS: number): number {
  // ~1800–3600 epochs across the record, snapped to review-station hops
  for (const h of [1, 2, 4, 5, 10, 15, 30, 60]) if (durationS / h <= 3600) return h;
  return 60;
}

export function allocTrends(durationS: number, fs: number, labels: string[], hopS = defaultHopS(durationS)): ViewerTrends {
  const nT = Math.max(1, Math.floor(durationS / hopS));
  const t = new Float32Array(nT);
  for (let i = 0; i < nT; i++) t[i] = (i + 0.5) * hopS;
  const nfft = nextPow2(TREND_WIN_S * fs);
  const df = fs / nfft;
  const nF = Math.floor(TREND_FMAX_HZ / df) + 1;
  const freqs = new Float32Array(nF);
  for (let i = 0; i < nF; i++) freqs[i] = i * df;
  const side = <T>(f: () => T): Record<Side, T> => ({ left: f(), right: f() });
  const pairs = aeegPairs(labels);
  return {
    hopS, t, nT, freqs,
    psd: side(() => new Float32Array(nF * nT)),
    aeegLo: side(() => new Float32Array(nT)),
    aeegHi: side(() => new Float32Array(nT)),
    sr: side(() => new Float32Array(nT)),
    adr: side(() => new Float32Array(nT)),
    totalPower: side(() => new Float32Array(nT)),
    asym: new Float32Array(nT),
    filled: 0,
    aeegDerivation: {
      left: pairs.left ? `${labels[pairs.left[0]]}-${labels[pairs.left[1]]}` : "—",
      right: pairs.right ? `${labels[pairs.right[0]]}-${labels[pairs.right[1]]}` : "—",
    },
  };
}

function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

function findLabel(labels: string[], name: string): number {
  const alias: Record<string, string[]> = { T3: ["T3", "T7"], T4: ["T4", "T8"], T5: ["T5", "P7"], T6: ["T6", "P8"] };
  const cands = (alias[name] ?? [name]).map((c) => c.toLowerCase());
  return labels.findIndex((l) => cands.includes(l.split(/[-\s]/)[0].replace(/^EEG\s*/i, "").toLowerCase()));
}

/** C3-P3 / C4-P4, then P3-O1 / P4-O2, then the first two hemisphere channels. */
export function aeegPairs(labels: string[]): Record<Side, [number, number] | null> {
  const pick = (a: string, b: string): [number, number] | null => {
    const i = findLabel(labels, a), j = findLabel(labels, b);
    return i >= 0 && j >= 0 ? [i, j] : null;
  };
  const hemi = hemisphereChannels(labels);
  const fallback = (idx: number[]): [number, number] | null => (idx.length >= 2 ? [idx[0], idx[1]] : null);
  return {
    left: pick("C3", "P3") ?? pick("P3", "O1") ?? fallback(hemi.left),
    right: pick("C4", "P4") ?? pick("P4", "O2") ?? fallback(hemi.right),
  };
}

// ── FFT ────────────────────────────────────────────────────────────────────

class Fft {
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;
  readonly window: Float32Array;
  readonly re: Float32Array;
  readonly im: Float32Array;
  constructor(readonly n: number) {
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = Math.sin((2 * Math.PI * i) / n); }
    this.rev = new Uint32Array(n);
    let bits = 0; while ((1 << bits) < n) bits++;
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.window = new Float32Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    this.re = new Float32Array(n); this.im = new Float32Array(n);
  }
  /** Power spectral density (µV²/Hz) of `x[start..start+n)` into `out[0..nF)`, accumulating. */
  psdInto(x: Float32Array, start: number, fs: number, out: Float32Array, outOffset: number, nF: number, scale: number) {
    const { n, re, im, rev, window } = this;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[start + i];
    mean /= n;
    let wsum = 0;
    for (let i = 0; i < n; i++) { re[rev[i]] = (x[start + i] - mean) * window[i]; im[i] = 0; wsum += window[i] * window[i]; }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const tr = re[i + j + half] * this.cos[k] + im[i + j + half] * this.sin[k];
          const ti = im[i + j + half] * this.cos[k] - re[i + j + half] * this.sin[k];
          re[i + j + half] = re[i + j] - tr; im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr; im[i + j] += ti;
        }
      }
    }
    const norm = scale / (fs * wsum);
    for (let f = 0; f < nF; f++) {
      const p = (re[f] * re[f] + im[f] * im[f]) * norm * (f === 0 ? 1 : 2);
      out[outOffset + f] += p;
    }
  }
}

// ── block processing ───────────────────────────────────────────────────────

export interface TrendEngine {
  /** Process a window of raw signal covering [t0, t0 + n/fs). Windows should
   *  arrive in order and include `marginS()` seconds of lead-in on both
   *  sides; epochs whose centre lies inside the margin are skipped. */
  process(t0: number, rows: Float32Array[]): void;
  marginS(): number;
  readonly trends: ViewerTrends;
}

export function createTrendEngine(durationS: number, fs: number, labels: string[]): TrendEngine {
  const trends = allocTrends(durationS, fs, labels);
  const nfft = nextPow2(TREND_WIN_S * fs);
  const fft = new Fft(nfft);
  const nF = trends.freqs.length;
  const hemi = hemisphereChannels(labels);
  const sides: Side[] = ["left", "right"];
  const pairs = aeegPairs(labels);
  const aeegChain = designChain(fs, { highPassHz: 2, lowPassHz: 15, notchHz: 0 });
  const srChain = designChain(fs, { highPassHz: 0.5, lowPassHz: 30, notchHz: 0 });
  const df = fs / nfft;
  const bandIdx = (lo: number, hi: number) => [Math.ceil(lo / df), Math.floor(hi / df)];
  const [d0, d1] = bandIdx(1, 4); const [a0, a1] = bandIdx(8, 13); const [p0, p1] = bandIdx(1, 20);
  const margin = Math.max(TREND_WIN_S / 2, AEEG_WINDOW_S / 2, SR_WINDOW_S / 2);

  function bandSum(psd: Float32Array, off: number, i0: number, i1: number): number {
    let s = 0; for (let i = i0; i <= i1 && i < nF; i++) s += psd[off + i]; return s * df;
  }

  function process(t0: number, rows: Float32Array[]) {
    const n = rows[0]?.length ?? 0;
    if (!n) return;
    const t1 = t0 + n / fs;
    const hop = trends.hopS;
    const e0 = Math.max(0, Math.ceil((t0 + margin - 0.5 * hop) / hop));
    const e1 = Math.min(trends.nT - 1, Math.floor((t1 - margin - 0.5 * hop) / hop));
    if (e1 < e0) return;

    // Pre-filter copies once per block.
    const aeegSig: Record<Side, Float32Array | null> = { left: null, right: null };
    for (const s of sides) {
      const p = pairs[s];
      if (!p) continue;
      const d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = rows[p[0]][i] - rows[p[1]][i];
      applyChain(d, aeegChain);
      for (let i = 0; i < n; i++) d[i] = Math.abs(d[i]);
      aeegSig[s] = d;
    }
    const srSig: Record<Side, Float32Array[]> = { left: [], right: [] };
    for (const s of sides) {
      for (const ch of hemi[s]) {
        const d = Float32Array.from(rows[ch]);
        applyChain(d, srChain);
        srSig[s].push(d);
      }
    }

    const half = Math.round((TREND_WIN_S / 2) * fs);
    const aeegHalf = Math.round((AEEG_WINDOW_S / 2) * fs);
    const srHalf = Math.round((SR_WINDOW_S / 2) * fs);
    const srEpochN = Math.max(1, Math.round(SR_EPOCH_S * fs));
    const sorted = new Float32Array(2 * aeegHalf);

    for (let e = e0; e <= e1; e++) {
      const centre = Math.round((trends.t[e] - t0) * fs);
      // spectrogram
      const start = centre - half;
      if (start < 0 || start + nfft > n) continue;
      const off = e * nF;
      for (const s of sides) {
        const psd = trends.psd[s];
        const chans = hemi[s];
        if (!chans.length) continue;
        for (let f = 0; f < nF; f++) psd[off + f] = 0;
        for (const ch of chans) fft.psdInto(rows[ch], start, fs, psd, off, nF, 1 / chans.length);
        const delta = bandSum(psd, off, d0, d1), alpha = bandSum(psd, off, a0, a1);
        trends.adr[s][e] = delta > 0 ? alpha / delta : 0;
        trends.totalPower[s][e] = bandSum(psd, off, p0, p1);
      }
      const L = trends.totalPower.left[e], R = trends.totalPower.right[e];
      trends.asym[e] = L + R > 0 ? (100 * (R - L)) / (R + L) : 0;

      // aEEG: 10th / 90th percentile of the rectified band-passed derivation
      for (const s of sides) {
        const sig = aeegSig[s];
        if (!sig) continue;
        const a = Math.max(0, centre - aeegHalf), b = Math.min(n, centre + aeegHalf);
        const len = b - a;
        sorted.set(sig.subarray(a, b));
        const view = sorted.subarray(0, len).sort();
        trends.aeegLo[s][e] = view[Math.floor(0.1 * (len - 1))];
        trends.aeegHi[s][e] = view[Math.floor(0.9 * (len - 1))];
      }

      // suppression ratio: % of 0.5 s epochs, across hemisphere channels,
      // whose peak-to-peak stays under the threshold
      for (const s of sides) {
        const sigs = srSig[s];
        if (!sigs.length) continue;
        const a = Math.max(0, centre - srHalf), b = Math.min(n, centre + srHalf);
        let suppressed = 0, total = 0;
        for (const sig of sigs) {
          for (let k = a; k + srEpochN <= b; k += srEpochN) {
            let lo = Infinity, hi = -Infinity;
            for (let i = k; i < k + srEpochN; i++) { const v = sig[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
            if (hi - lo < 2 * SR_THRESHOLD_UV) suppressed++;
            total++;
          }
        }
        trends.sr[s][e] = total ? (100 * suppressed) / total : 0;
      }
      trends.filled = Math.max(trends.filled, e + 1);
    }
  }

  return { process, marginS: () => margin, trends };
}
