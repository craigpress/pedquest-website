// Per-page IIR filtering. Second-order Butterworth high/low-pass and a
// notch, applied forward over the page plus a settling margin the caller
// trims. Review-station conventions, not analysis-grade: no zero-phase pass,
// because a learner paging through a file expects the same look Persyst gives.

export interface FilterSettings {
  /** Hz; 0 disables */
  highPassHz: number;
  /** Hz; 0 disables */
  lowPassHz: number;
  /** 0 | 50 | 60 */
  notchHz: number;
}

export const DEFAULT_FILTERS: FilterSettings = { highPassHz: 1, lowPassHz: 70, notchHz: 60 };

export const HIGH_PASS_OPTIONS = [0, 0.1, 0.3, 0.5, 1, 1.6, 3, 5];
export const LOW_PASS_OPTIONS = [0, 15, 30, 35, 50, 70, 100];
export const NOTCH_OPTIONS = [0, 50, 60];

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function butter2(fs: number, fc: number, kind: "low" | "high"): Biquad {
  const w = Math.tan((Math.PI * fc) / fs);
  const w2 = w * w;
  const q = Math.SQRT2;
  const norm = 1 / (1 + q * w + w2);
  if (kind === "low") {
    return { b0: w2 * norm, b1: 2 * w2 * norm, b2: w2 * norm, a1: 2 * (w2 - 1) * norm, a2: (1 - q * w + w2) * norm };
  }
  return { b0: norm, b1: -2 * norm, b2: norm, a1: 2 * (w2 - 1) * norm, a2: (1 - q * w + w2) * norm };
}

function notch(fs: number, f0: number, q = 30): Biquad {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: 1 / a0, b1: (-2 * Math.cos(w0)) / a0, b2: 1 / a0,
    a1: (-2 * Math.cos(w0)) / a0, a2: (1 - alpha) / a0,
  };
}

export function designChain(fs: number, s: FilterSettings): Biquad[] {
  const chain: Biquad[] = [];
  if (s.highPassHz > 0 && s.highPassHz < fs / 2) chain.push(butter2(fs, s.highPassHz, "high"));
  if (s.lowPassHz > 0 && s.lowPassHz < fs / 2) chain.push(butter2(fs, s.lowPassHz, "low"));
  if (s.notchHz > 0 && s.notchHz < fs / 2) chain.push(notch(fs, s.notchHz));
  return chain;
}

/** Filters in place. */
export function applyChain(x: Float32Array, chain: Biquad[]): Float32Array {
  for (const c of chain) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const x0 = x[i];
      const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      x[i] = y0;
    }
  }
  return x;
}

/** Seconds of lead-in the page reader should fetch so the filters settle. */
export function settlingMarginS(s: FilterSettings): number {
  if (s.highPassHz > 0) return Math.min(10, Math.max(2, 3 / s.highPassHz));
  return 1;
}
