"use client";

// The qEEG strip: trends on one canvas with a shared time cursor.
//
// Rows come from a panel preset (TREND_PANELS), clustered by type — both aEEG
// rows together, both spectrograms together — so left/right compare by eye.
// The strip shows either the whole record or a window of `windowS` seconds
// starting at `windowT0`; drag or wheel to scroll. Spectrogram bitmaps are
// rendered once per (palette, fill, baseline) and cached, so changing the
// window or panel is a redraw, not a recompute.
//
// Two derived families follow Persyst's Asymmetry and VsBaseline panels in
// spirit: a relative-asymmetry spectrogram (100·(R−L)/(R+L) per frequency,
// diverging colours, red = right louder) and "vs baseline" rows expressed as
// dB (spectrograms) or percent change (scalars) against the mean of a
// baseline window the user chooses.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  asymmetryAt, baselineStats, pctChange, spectrumFloor, vsBaselineDb, type BaselineStats, type ViewerTrends,
} from "@/lib/eeg/trends";
import { annotationColor, formatClock, type ViewerAnnotation } from "@/lib/eeg/annotations";
import { PALETTES, buildLut, type PaletteId } from "@/lib/eeg-palette";

const GUTTER = 72;
const AXIS_H = 18;

export type TrendRowId =
  | "aeeg_left" | "aeeg_right" | "psd_left" | "psd_right" | "asym_spec"
  | "sr" | "adr" | "power" | "asym"
  | "psd_vs_left" | "psd_vs_right" | "power_vs" | "adr_vs";

interface RowDef { id: TrendRowId; label: string; h: number; needsBaseline?: boolean }
const ROW_DEFS: Record<TrendRowId, RowDef> = {
  aeeg_left: { id: "aeeg_left", label: "aEEG L", h: 44 },
  aeeg_right: { id: "aeeg_right", label: "aEEG R", h: 44 },
  psd_left: { id: "psd_left", label: "FFT L", h: 52 },
  psd_right: { id: "psd_right", label: "FFT R", h: 52 },
  asym_spec: { id: "asym_spec", label: "Asym FFT", h: 52 },
  sr: { id: "sr", label: "Suppr %", h: 30 },
  adr: { id: "adr", label: "α/δ", h: 30 },
  power: { id: "power", label: "Power", h: 30 },
  asym: { id: "asym", label: "Asym %", h: 28 },
  psd_vs_left: { id: "psd_vs_left", label: "FFT vs BL L", h: 52, needsBaseline: true },
  psd_vs_right: { id: "psd_vs_right", label: "FFT vs BL R", h: 52, needsBaseline: true },
  power_vs: { id: "power_vs", label: "Power vs BL", h: 34, needsBaseline: true },
  adr_vs: { id: "adr_vs", label: "α/δ vs BL", h: 34, needsBaseline: true },
};

export interface TrendPanel { id: string; label: string; rows: TrendRowId[] }
export const TREND_PANELS: TrendPanel[] = [
  { id: "standard", label: "Standard", rows: ["aeeg_left", "aeeg_right", "psd_left", "psd_right", "asym_spec", "sr", "adr", "asym"] },
  { id: "seizure", label: "Seizure screen", rows: ["psd_left", "psd_right", "asym_spec", "aeeg_left", "aeeg_right", "power", "asym"] },
  { id: "ischemia", label: "Ischemia / stroke", rows: ["asym_spec", "asym", "adr", "adr_vs", "psd_vs_left", "psd_vs_right", "power_vs"] },
  { id: "vsbaseline", label: "vs Baseline (comprehensive)", rows: ["psd_vs_left", "psd_vs_right", "asym_spec", "power_vs", "adr_vs", "sr", "aeeg_left", "aeeg_right"] },
  { id: "sedation", label: "Sedation / suppression", rows: ["aeeg_left", "aeeg_right", "sr", "psd_left", "psd_right", "power"] },
  { id: "neonatal", label: "Neonatal", rows: ["aeeg_left", "aeeg_right", "sr", "psd_left", "psd_right"] },
  { id: "aeeg", label: "aEEG only", rows: ["aeeg_left", "aeeg_right"] },
  { id: "fft", label: "Spectrogram only", rows: ["psd_left", "psd_right", "asym_spec"] },
];

/** Selectable visible spans, seconds; null = whole record. */
export const TREND_WINDOWS: { id: string; label: string; s: number | null }[] = [
  { id: "full", label: "Whole record", s: null },
  { id: "10m", label: "10 min", s: 600 },
  { id: "30m", label: "30 min", s: 1800 },
  { id: "1h", label: "1 h", s: 3600 },
  { id: "2h", label: "2 h", s: 7200 },
  { id: "4h", label: "4 h", s: 14400 },
  { id: "8h", label: "8 h", s: 28800 },
];

export function trendStripHeight(rows: TrendRowId[]): number {
  return AXIS_H + rows.reduce((s, r) => s + ROW_DEFS[r].h, 0) + 6;
}

// Diverging map for asymmetry and vs-baseline: blue (less / left) → white → red (more / right),
// the review-station convention — symmetric / unchanged reads as blank paper.
const DIVERGING: [number, string][] = [
  [0.0, "#1f4fd8"], [0.5, "#ffffff"], [1.0, "#e0202a"],
];

/** Wheel travel (px) that counts as one notch when the wheel pages the raw EEG. */
const WHEEL_NOTCH_PX = 60;

export default function TrendStrip({
  trends, durationS, cursorT, pageT0, pageS, annotations, answerSpans, progress,
  rows, palette, windowT0, windowS, baseline, theme, height, onSeek, onScroll, onPage, onSelect,
}: {
  trends: ViewerTrends | null;
  durationS: number;
  cursorT: number | null;
  pageT0: number;
  pageS: number;
  annotations: ViewerAnnotation[];
  answerSpans: { onsetS: number; offsetS: number; label: string }[];
  /** 0..1 while trends are computing */
  progress: number;
  rows: TrendRowId[];
  palette: PaletteId;
  windowT0: number;
  /** null = whole record */
  windowS: number | null;
  /** baseline window for the "vs BL" rows; null = none chosen */
  baseline: { t0: number; t1: number } | null;
  /** re-reads the CSS tokens when it changes */
  theme: "dark" | "light";
  /** strip height in CSS px; rows scale to fill it. Omit for the natural height. */
  height?: number | null;
  onSeek: (t: number) => void;
  onScroll: (deltaS: number) => void;
  /** wheel when the whole record is shown: move the raw page by this many seconds */
  onPage?: (deltaS: number) => void;
  /** Shift-drag on the strip selected [t0, t1]; the parent decides what to do with it (plain drag scrubs) */
  onSelect?: (t0: number, t1: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(800);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const natural = trendStripHeight(rows);
  const h = height && height > AXIS_H + 6 + rows.length * 8 ? Math.round(height) : natural;
  const scale = (h - AXIS_H - 6) / Math.max(1, natural - AXIS_H - 6);
  const span = windowS ?? Math.max(1, durationS);
  const t0 = windowS ? windowT0 : 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, Math.floor(el.getBoundingClientRect().width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowTop = useMemo(() => {
    const tops: Partial<Record<TrendRowId, number>> = {};
    let y = AXIS_H;
    for (const r of rows) { tops[r] = y; y += ROW_DEFS[r].h * scale; }
    return tops as Record<TrendRowId, number>;
  }, [rows, scale]);

  const filled = trends?.filled ?? 0;

  // Baseline statistics: recomputed when the window moves or the fill grows past it.
  const base: BaselineStats | null = useMemo(() => {
    if (!trends || !baseline || !filled) return null;
    return baselineStats(trends, baseline.t0, baseline.t1);
  }, [trends, baseline, filled]);

  // Heat bitmaps, one offscreen canvas per row, rebuilt only when their inputs change.
  const bitmaps = useMemo(() => {
    if (!trends || !filled || typeof document === "undefined") return null;
    const nF = trends.freqs.length, nT = trends.nT;
    const heatLut = buildLut(PALETTES.find((p) => p.id === palette)!.stops);
    const divLut = buildLut(DIVERGING);
    const eps = spectrumFloor(trends);
    const paint = (cell: (e: number, f: number) => number, lut: Uint8ClampedArray) => {
      const img = new ImageData(nT, nF);
      for (let e = 0; e < nT; e++) {
        const done = e < filled;
        for (let f = 0; f < nF; f++) {
          const o = ((nF - 1 - f) * nT + e) * 4;
          if (!done) { const g = theme === "light" ? 235 : 20; img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g + 4; img.data[o + 3] = 255; continue; }
          const k = Math.max(0, Math.min(255, Math.round(cell(e, f) * 255))) * 3;
          img.data[o] = lut[k]; img.data[o + 1] = lut[k + 1]; img.data[o + 2] = lut[k + 2]; img.data[o + 3] = 255;
        }
      }
      const c = document.createElement("canvas");
      c.width = nT; c.height = nF;
      c.getContext("2d")!.putImageData(img, 0, 0);
      return c;
    };
    // log10 power, fixed review-station range 0.1 .. 100 µV²/Hz
    const power = (side: "left" | "right") => (e: number, f: number) => (Math.log10(Math.max(trends.psd[side][e * nF + f], 1e-3)) + 1) / 3;
    const out: Partial<Record<TrendRowId, HTMLCanvasElement>> = {
      psd_left: paint(power("left"), heatLut),
      psd_right: paint(power("right"), heatLut),
      asym_spec: paint((e, f) => (asymmetryAt(trends, e, f, eps) + 100) / 200, divLut),
    };
    if (base) {
      // ±10 dB full scale
      out.psd_vs_left = paint((e, f) => (vsBaselineDb(trends, base, "left", e, f, eps) + 10) / 20, divLut);
      out.psd_vs_right = paint((e, f) => (vsBaselineDb(trends, base, "right", e, f, eps) + 10) / 20, divLut);
    }
    return out;
  }, [trends, filled, palette, base, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const col = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
    const bg = col("--bg-card", "#111"), grid = col("--border", "#333"), text = col("--text-muted", "#999");
    const accent = col("--accent-primary", "#4cc9b0"), trace = col("--text", "#eee");
    const overlay = col("--lab-overlay", "rgba(255,255,255,0.10)");
    const left = theme === "light" ? "#1f5fd0" : "#5aa9ff", right = theme === "light" ? "#d9531e" : "#ff8a5a";

    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const plotW = w - GUTTER - 8;
    const xOf = (t: number) => GUTTER + ((t - t0) / span) * plotW;
    const t1 = t0 + span;
    const has = (r: TrendRowId) => rows.includes(r);
    const rh = (r: TrendRowId) => ROW_DEFS[r].h * scale;

    // time axis
    ctx.font = "10px var(--mono-font, monospace)"; ctx.textBaseline = "top"; ctx.textAlign = "center";
    const tickS = span > 6 * 3600 ? 3600 : span > 5400 ? 1800 : span > 1800 ? 600 : span > 600 ? 300 : span > 300 ? 60 : 30;
    for (let s = Math.ceil(t0 / tickS) * tickS; s <= t1; s += tickS) {
      const x = xOf(s);
      ctx.strokeStyle = grid; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, AXIS_H); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = text; ctx.fillText(formatClock(s), x, 3);
    }

    // row labels + separators
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const r of rows) {
      const y = rowTop[r];
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(GUTTER, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillStyle = text; ctx.fillText(ROW_DEFS[r].label, GUTTER - 8, y + rh(r) / 2);
    }

    if (trends) {
      const hop = trends.hopS;
      const e0 = Math.max(0, Math.floor(t0 / hop)), e1 = Math.min(filled, Math.ceil(t1 / hop));

      const drawImg = (id: TrendRowId) => {
        const bmp = bitmaps?.[id];
        if (!has(id)) return;
        if (!bmp) {
          if (ROW_DEFS[id].needsBaseline) {
            ctx.fillStyle = text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
            ctx.fillText(base === null && baseline ? "baseline window has too few epochs yet" : "choose a baseline window", GUTTER + 8, rowTop[id] + rh(id) / 2);
          }
          return;
        }
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        ctx.beginPath(); ctx.rect(GUTTER, rowTop[id] + 1, plotW, rh(id) - 2); ctx.clip();
        ctx.drawImage(bmp, t0 / hop, 0, span / hop, bmp.height, GUTTER, rowTop[id] + 1, plotW, rh(id) - 2);
        ctx.restore();
      };
      for (const id of ["psd_left", "psd_right", "asym_spec", "psd_vs_left", "psd_vs_right"] as TrendRowId[]) drawImg(id);

      // aEEG: semi-log band between 10th and 90th percentile; 0–10 linear, 10–100 log
      const aeegY = (uv: number, top: number, height: number) => {
        const v = Math.max(0, uv);
        const frac = v <= 10 ? (v / 10) * 0.5 : 0.5 + 0.5 * Math.min(1, Math.log10(v / 10));
        return top + height - 2 - frac * (height - 4);
      };
      const band = (id: TrendRowId, lo: Float32Array, hi: Float32Array, colr: string) => {
        if (!has(id)) return;
        const top = rowTop[id], height = rh(id);
        ctx.fillStyle = colr + "99";
        for (let i = e0; i < e1; i++) {
          const x0 = Math.max(GUTTER, xOf(i * hop)), x1 = Math.min(w, xOf((i + 1) * hop));
          if (x1 <= x0) continue;
          const yh = aeegY(hi[i], top, height), yl = aeegY(lo[i], top, height);
          ctx.fillRect(x0, yh, Math.max(1, x1 - x0), Math.max(1, yl - yh));
        }
        ctx.strokeStyle = grid; ctx.setLineDash([2, 3]);
        for (const ref of [5, 10, 50]) { const y = aeegY(ref, top, height); ctx.beginPath(); ctx.moveTo(GUTTER, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.setLineDash([]);
      };
      band("aeeg_left", trends.aeegLo.left, trends.aeegHi.left, left);
      band("aeeg_right", trends.aeegLo.right, trends.aeegHi.right, right);

      const line = (id: TrendRowId, value: (i: number) => number, colr: string, ymin: number, ymax: number) => {
        if (!has(id)) return;
        const top = rowTop[id], height = rh(id);
        ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
        let started = false;
        for (let i = e0; i < e1; i++) {
          const x = xOf(trends.t[i]);
          const frac = Math.min(1, Math.max(0, (value(i) - ymin) / (ymax - ymin)));
          const y = top + height - 2 - frac * (height - 4);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      const zeroLine = (id: TrendRowId, ymin: number, ymax: number) => {
        const top = rowTop[id], height = rh(id);
        const y = top + height - 2 - ((0 - ymin) / (ymax - ymin)) * (height - 4);
        ctx.strokeStyle = grid; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(GUTTER, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
      };
      line("sr", (i) => trends.sr.left[i], left, 0, 100);
      line("sr", (i) => trends.sr.right[i], right, 0, 100);
      line("adr", (i) => trends.adr.left[i], left, 0, 2);
      line("adr", (i) => trends.adr.right[i], right, 0, 2);
      // total power on a log axis, 1 .. 10⁴ µV²
      line("power", (i) => Math.log10(Math.max(trends.totalPower.left[i], 1e-3)), left, 0, 4);
      line("power", (i) => Math.log10(Math.max(trends.totalPower.right[i], 1e-3)), right, 0, 4);

      if (base) {
        // percent change from baseline. Power is drawn on a signed log axis
        // (−100 % .. +1000 %) so a seizure's tenfold rise is not flat-topped.
        const slog = (pct: number) => Math.sign(pct) * Math.log10(1 + Math.abs(pct) / 100);
        if (has("power_vs")) zeroLine("power_vs", slog(-100), slog(1000));
        line("power_vs", (i) => slog(pctChange(trends.totalPower.left[i], base.totalPower.left)), left, slog(-100), slog(1000));
        line("power_vs", (i) => slog(pctChange(trends.totalPower.right[i], base.totalPower.right)), right, slog(-100), slog(1000));
        if (has("adr_vs")) zeroLine("adr_vs", -100, 200);
        line("adr_vs", (i) => pctChange(trends.adr.left[i], base.adr.left), left, -100, 200);
        line("adr_vs", (i) => pctChange(trends.adr.right[i], base.adr.right), right, -100, 200);
      } else {
        for (const id of ["power_vs", "adr_vs"] as TrendRowId[]) {
          if (!has(id)) continue;
          ctx.fillStyle = text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText("choose a baseline window", GUTTER + 8, rowTop[id] + rh(id) / 2);
        }
      }

      if (has("asym")) {
        const top = rowTop.asym, height = rh("asym"), mid = top + height / 2;
        ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(GUTTER, mid); ctx.lineTo(w, mid); ctx.stroke();
        for (let i = e0; i < e1; i++) {
          const x0 = Math.max(GUTTER, xOf(i * hop)), x1 = Math.min(w, xOf((i + 1) * hop));
          if (x1 <= x0) continue;
          const v = Math.max(-100, Math.min(100, trends.asym[i]));
          const dy = (v / 100) * (height / 2 - 2);
          ctx.fillStyle = v >= 0 ? right : left;
          ctx.fillRect(x0, Math.min(mid, mid - dy), Math.max(1, x1 - x0), Math.abs(dy));
        }
      }
    }

    if (progress < 1) {
      const x = Math.max(GUTTER, Math.min(w, xOf(progress * durationS)));
      ctx.fillStyle = theme === "light" ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)"; ctx.fillRect(x, AXIS_H, w - x, h - AXIS_H);
      ctx.fillStyle = text; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`computing trends… ${Math.round(progress * 100)}%`, Math.min(x + 6, w - 160), AXIS_H + 4);
    }

    // baseline window
    if (baseline) {
      const x0 = Math.max(GUTTER, xOf(baseline.t0)), x1 = Math.min(w, xOf(baseline.t1));
      if (x1 > x0) {
        ctx.fillStyle = "rgba(76,201,176,0.10)"; ctx.fillRect(x0, AXIS_H, x1 - x0, h - AXIS_H);
        ctx.strokeStyle = accent; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, AXIS_H + 0.5, x1 - x0 - 1, h - AXIS_H - 1); ctx.setLineDash([]);
        ctx.fillStyle = accent; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "10px var(--mono-font, monospace)";
        ctx.fillText(base ? "BASELINE" : "BASELINE (computing)", x0 + 4, AXIS_H + 3);
      }
    }

    // answer key
    for (const a of answerSpans) {
      const x0 = xOf(a.onsetS), x1 = Math.max(x0 + 2, xOf(a.offsetS));
      if (x1 < GUTTER || x0 > w) continue;
      ctx.fillStyle = "rgba(229,72,77,0.28)"; ctx.fillRect(Math.max(GUTTER, x0), AXIS_H, Math.min(w, x1) - Math.max(GUTTER, x0), h - AXIS_H);
    }
    // annotations
    for (const a of annotations) {
      const x0 = xOf(a.onsetS), x1 = Math.max(x0 + 1.5, xOf(a.onsetS + a.durationS));
      if (x1 < GUTTER || x0 > w) continue;
      ctx.fillStyle = annotationColor(a.kind) + (a.mine ? "cc" : "66");
      ctx.fillRect(Math.max(GUTTER, x0), AXIS_H - 6, Math.min(w, x1) - Math.max(GUTTER, x0), 6);
    }

    // drag selection in progress
    if (sel) {
      const x0 = Math.max(GUTTER, xOf(Math.min(sel.a, sel.b))), x1 = Math.min(w, xOf(Math.max(sel.a, sel.b)));
      if (x1 > x0) {
        ctx.fillStyle = "rgba(76,201,176,0.22)"; ctx.fillRect(x0, AXIS_H, x1 - x0, h - AXIS_H);
        ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, AXIS_H + 0.5, x1 - x0 - 1, h - AXIS_H - 1);
        ctx.fillStyle = accent; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "10px var(--mono-font, monospace)";
        ctx.fillText(`${formatClock(Math.min(sel.a, sel.b))} – ${formatClock(Math.max(sel.a, sel.b))}`, x0 + 4, AXIS_H + 3);
      }
    }

    // current page window
    const px0 = xOf(pageT0), px1 = Math.max(px0 + 2, xOf(pageT0 + pageS));
    if (px1 >= GUTTER && px0 <= w) {
      ctx.fillStyle = overlay;
      ctx.fillRect(px0, AXIS_H, px1 - px0, h - AXIS_H);
      ctx.strokeStyle = trace; ctx.lineWidth = 1;
      ctx.strokeRect(px0, AXIS_H, px1 - px0, h - AXIS_H);
    }

    if (cursorT !== null && cursorT >= t0 && cursorT <= t1) {
      const x = xOf(cursorT);
      ctx.strokeStyle = accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // window scrollbar when zoomed
    if (windowS && durationS > windowS) {
      const sbY = h - 3;
      ctx.fillStyle = grid; ctx.fillRect(GUTTER, sbY, plotW, 3);
      ctx.fillStyle = accent;
      ctx.fillRect(GUTTER + (t0 / durationS) * plotW, sbY, Math.max(6, (span / durationS) * plotW), 3);
    }
  }, [trends, bitmaps, base, baseline, filled, durationS, cursorT, pageT0, pageS, annotations, answerSpans, progress, w, h, scale, rowTop, rows, t0, span, windowS, theme, sel]);

  const timeAt = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = (clientX - r.left - GUTTER) / (w - GUTTER - 8);
    return Math.min(durationS, Math.max(0, t0 + frac * span));
  };
  // A press seeks and a drag scrubs the cursor; Shift-drag selects a span to mark.
  const dragRef = useRef<{ x0: number; t: number; moved: boolean; scrub: boolean } | null>(null);

  // Wheel: zoomed in, it scrolls the trend window; on the whole record it
  // pages the raw EEG (one page per notch, 1 s with Shift). A passive listener
  // would not let us stop the document scrolling.
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const raw = e.deltaMode === 1 ? (e.deltaY || e.deltaX) * 20 : (e.deltaY || e.deltaX);
      if (windowS) {
        e.preventDefault();
        onScroll(raw * (span / 1000));
        return;
      }
      if (!onPage) return;
      e.preventDefault();
      wheelAcc.current += raw;
      const notches = Math.trunc(wheelAcc.current / WHEEL_NOTCH_PX);
      if (!notches) return;
      wheelAcc.current -= notches * WHEEL_NOTCH_PX;
      onPage(notches * (e.shiftKey ? 1 : pageS));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [windowS, span, onScroll, onPage, pageS]);

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: w, height: h, display: "block", cursor: "pointer", touchAction: "pan-y" }}
        onPointerCancel={() => { dragRef.current = null; setSel(null); }}
        onPointerDown={(e) => {
          if (e.clientX - canvasRef.current!.getBoundingClientRect().left < GUTTER) return;
          const t = timeAt(e.clientX);
          const scrub = !e.shiftKey || !onSelect;
          dragRef.current = { x0: e.clientX, t, moved: false, scrub };
          try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
          if (scrub) onSeek(t);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          if (d.scrub) { onSeek(timeAt(e.clientX)); return; }
          if (Math.abs(e.clientX - d.x0) > 4) d.moved = true;
          if (d.moved) setSel({ a: d.t, b: timeAt(e.clientX) });
        }}
        onPointerUp={(e) => {
          const d = dragRef.current;
          dragRef.current = null;
          if (!d || d.scrub) return;
          if (d.moved && onSelect) {
            const t1 = timeAt(e.clientX);
            setSel(null);
            onSelect(Math.min(d.t, t1), Math.max(d.t, t1));
          } else {
            onSeek(d.t);
          }
        }}
      />
    </div>
  );
}
