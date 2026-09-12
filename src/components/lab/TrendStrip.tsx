"use client";

// The qEEG strip: trends on one canvas with a shared time cursor.
//
// Rows come from a panel preset (TREND_PANELS), clustered by type — both aEEG
// rows together, both spectrograms together — so left/right compare by eye.
// The strip shows either the whole record or a window of `windowS` seconds
// starting at `windowT0`; drag or wheel to scroll. Spectrogram bitmaps are
// rendered once per (palette, fill) and cached, so changing the window or
// panel is a redraw, not a recompute.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewerTrends } from "@/lib/eeg/trends";
import { annotationColor, formatClock, type ViewerAnnotation } from "@/lib/eeg/annotations";
import { PALETTES, buildLut, type PaletteId } from "@/lib/eeg-palette";

const GUTTER = 72;
const AXIS_H = 18;

export type TrendRowId =
  | "aeeg_left" | "aeeg_right" | "psd_left" | "psd_right"
  | "sr" | "adr" | "power" | "asym";

interface RowDef { id: TrendRowId; label: string; h: number; group: string }
const ROW_DEFS: Record<TrendRowId, RowDef> = {
  aeeg_left: { id: "aeeg_left", label: "aEEG L", h: 44, group: "aeeg" },
  aeeg_right: { id: "aeeg_right", label: "aEEG R", h: 44, group: "aeeg" },
  psd_left: { id: "psd_left", label: "FFT L", h: 52, group: "fft" },
  psd_right: { id: "psd_right", label: "FFT R", h: 52, group: "fft" },
  sr: { id: "sr", label: "Suppr %", h: 30, group: "ratio" },
  adr: { id: "adr", label: "α/δ", h: 30, group: "ratio" },
  power: { id: "power", label: "Power", h: 30, group: "ratio" },
  asym: { id: "asym", label: "Asym %", h: 28, group: "asym" },
};

export interface TrendPanel { id: string; label: string; rows: TrendRowId[] }
export const TREND_PANELS: TrendPanel[] = [
  { id: "standard", label: "Standard", rows: ["aeeg_left", "aeeg_right", "psd_left", "psd_right", "sr", "adr", "asym"] },
  { id: "seizure", label: "Seizure screen", rows: ["psd_left", "psd_right", "aeeg_left", "aeeg_right", "power", "asym"] },
  { id: "ischemia", label: "Ischemia", rows: ["adr", "asym", "psd_left", "psd_right", "power"] },
  { id: "sedation", label: "Sedation / suppression", rows: ["aeeg_left", "aeeg_right", "sr", "psd_left", "psd_right", "power"] },
  { id: "neonatal", label: "Neonatal", rows: ["aeeg_left", "aeeg_right", "sr", "psd_left", "psd_right"] },
  { id: "aeeg", label: "aEEG only", rows: ["aeeg_left", "aeeg_right"] },
  { id: "fft", label: "Spectrogram only", rows: ["psd_left", "psd_right"] },
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

export default function TrendStrip({
  trends, durationS, cursorT, pageT0, pageS, annotations, answerSpans, progress,
  rows, palette, windowT0, windowS, onSeek, onScroll,
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
  onSeek: (t: number) => void;
  onScroll: (deltaS: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(800);
  const h = trendStripHeight(rows);
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
    for (const r of rows) { tops[r] = y; y += ROW_DEFS[r].h; }
    return tops as Record<TrendRowId, number>;
  }, [rows]);

  // Spectrogram bitmaps: one offscreen canvas per side, rebuilt only when the
  // fill advances or the palette changes. Drawing a window is a drawImage crop.
  const filled = trends?.filled ?? 0;
  const bitmaps = useMemo(() => {
    if (!trends || !filled || typeof document === "undefined") return null;
    const lut = buildLut(PALETTES.find((p) => p.id === palette)!.stops);
    const nF = trends.freqs.length;
    const build = (psd: Float32Array) => {
      const img = new ImageData(trends.nT, nF);
      // log10 power, fixed review-station range 0.1 .. 100 µV²/Hz
      for (let t = 0; t < trends.nT; t++) {
        const done = t < filled;
        for (let f = 0; f < nF; f++) {
          const o = ((nF - 1 - f) * trends.nT + t) * 4;
          if (!done) { img.data[o] = 20; img.data[o + 1] = 20; img.data[o + 2] = 24; img.data[o + 3] = 255; continue; }
          const v = (Math.log10(Math.max(psd[t * nF + f], 1e-3)) + 1) / 3;
          const k = Math.max(0, Math.min(255, Math.round(v * 255))) * 3;
          img.data[o] = lut[k]; img.data[o + 1] = lut[k + 1]; img.data[o + 2] = lut[k + 2]; img.data[o + 3] = 255;
        }
      }
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.putImageData(img, 0, 0);
      return c;
    };
    return { left: build(trends.psd.left), right: build(trends.psd.right) };
  }, [trends, filled, palette]);

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
    const left = "#5aa9ff", right = "#ff8a5a";

    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const plotW = w - GUTTER - 8;
    const xOf = (t: number) => GUTTER + ((t - t0) / span) * plotW;
    const t1 = t0 + span;
    const has = (r: TrendRowId) => rows.includes(r);
    const rh = (r: TrendRowId) => ROW_DEFS[r].h;

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
      // epoch index range for the window
      const e0 = Math.max(0, Math.floor(t0 / hop)), e1 = Math.min(filled, Math.ceil(t1 / hop));

      if (bitmaps) {
        const drawImg = (bmp: HTMLCanvasElement, id: TrendRowId) => {
          if (!has(id)) return;
          // source columns for [t0, t1) — fractional, so the crop scrolls smoothly
          const sx = (t0 / hop), sw = (span / hop);
          ctx.imageSmoothingEnabled = false;
          ctx.save();
          ctx.beginPath(); ctx.rect(GUTTER, rowTop[id] + 1, plotW, rh(id) - 2); ctx.clip();
          ctx.drawImage(bmp, sx, 0, sw, bmp.height, GUTTER, rowTop[id] + 1, plotW, rh(id) - 2);
          ctx.restore();
        };
        drawImg(bitmaps.left, "psd_left");
        drawImg(bitmaps.right, "psd_right");
      }

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

      const line = (id: TrendRowId, ys: Float32Array, colr: string, ymin: number, ymax: number, log = false) => {
        if (!has(id)) return;
        const top = rowTop[id], height = rh(id);
        ctx.strokeStyle = colr; ctx.lineWidth = 1; ctx.beginPath();
        let started = false;
        for (let i = e0; i < e1; i++) {
          const x = xOf(trends.t[i]);
          const v = log ? Math.log10(Math.max(ys[i], 1e-3)) : ys[i];
          const frac = Math.min(1, Math.max(0, (v - ymin) / (ymax - ymin)));
          const y = top + height - 2 - frac * (height - 4);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      line("sr", trends.sr.left, left, 0, 100);
      line("sr", trends.sr.right, right, 0, 100);
      line("adr", trends.adr.left, left, 0, 2);
      line("adr", trends.adr.right, right, 0, 2);
      // total power on a log axis, 1 .. 10⁴ µV²
      line("power", trends.totalPower.left, left, 0, 4, true);
      line("power", trends.totalPower.right, right, 0, 4, true);

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
      ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(x, AXIS_H, w - x, h - AXIS_H);
      ctx.fillStyle = text; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(`computing trends… ${Math.round(progress * 100)}%`, Math.min(x + 6, w - 160), AXIS_H + 4);
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

    // current page window
    const px0 = xOf(pageT0), px1 = Math.max(px0 + 2, xOf(pageT0 + pageS));
    if (px1 >= GUTTER && px0 <= w) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
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
  }, [trends, bitmaps, filled, durationS, cursorT, pageT0, pageS, annotations, answerSpans, progress, w, h, rowTop, rows, t0, span, windowS]);

  const seekAt = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = (clientX - r.left - GUTTER) / (w - GUTTER - 8);
    onSeek(Math.min(durationS, Math.max(0, t0 + frac * span)));
  };
  const dragging = useRef(false);

  // Wheel scrolls the window; a passive listener would not let us stop the page scrolling.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!windowS) return;
      e.preventDefault();
      const delta = (e.deltaY || e.deltaX) * (span / 1000);
      onScroll(delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [windowS, span, onScroll]);

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        style={{ width: w, height: h, display: "block", cursor: "pointer", touchAction: "none" }}
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); seekAt(e.clientX); }}
        onPointerMove={(e) => { if (dragging.current) seekAt(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
      />
    </div>
  );
}
