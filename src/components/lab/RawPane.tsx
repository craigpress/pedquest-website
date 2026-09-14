"use client";

// The raw EEG page: one canvas, N derivations, a timebase of `pageS` seconds
// starting at `t0`. Fetches its own window from the reader (with a lead-in so
// the filters settle), filters the recorded channels, then derives the montage
// — filtering is linear, so the order does not matter and the cache stays
// montage-independent.

import { useEffect, useMemo, useRef, useState } from "react";
import type { EdfAnnotation } from "@/lib/eeg/edf";
import type { Recording } from "@/lib/eeg/recording";
import { applyChain, designChain, settlingMarginS, type FilterSettings } from "@/lib/eeg/filters";
import { applyMontage, type Derivation } from "@/lib/eeg/montage";
import { annotationColor, describeTarget, type ViewerAnnotation } from "@/lib/eeg/annotations";
import { formatClock } from "@/lib/eeg/annotations";

/** CSS px per mm at 96 dpi; sensitivity is quoted in µV/mm like a review station. */
const PX_PER_MM = 96 / 25.4;
const GUTTER = 72;
const AXIS_H = 20;

interface Page { t0: number; fs: number; rows: Float32Array[]; fileAnnotations: EdfAnnotation[] }

/** Wheel travel (px) that counts as one notch → one page. Trackpads send many small deltas. */
const WHEEL_NOTCH_PX = 60;

export default function RawPane({
  reader, t0, pageS, derivations, filters, sensitivityUvPerMm, auxSensitivityUvPerMm, annotations, answerSpans, cursorT,
  theme, penWidth = 0.75, onCursor, onSelect, onLoading, onPage,
}: {
  reader: Recording;
  t0: number;
  pageS: number;
  derivations: Derivation[];
  filters: FilterSettings;
  sensitivityUvPerMm: number;
  /** EKG / ear rows are painted at their own gain */
  auxSensitivityUvPerMm: number;
  annotations: ViewerAnnotation[];
  /** instructor overlay: [onset, offset, label] */
  answerSpans: { onsetS: number; offsetS: number; label: string }[];
  cursorT: number | null;
  /** re-reads the CSS tokens when it changes */
  theme: "dark" | "light";
  /** trace line width in CSS px; review stations draw hairlines */
  penWidth?: number;
  /** `channel` is the derivation row the press landed on, so the mark can name it */
  onCursor: (t: number, channel: string | null) => void;
  /** drag-select a span; the parent decides what to do with it */
  onSelect: (t0: number, t1: number, channel: string | null) => void;
  onLoading?: (busy: boolean) => void;
  /** wheel over the page: move by this many seconds (one page per notch, 1 s with Shift) */
  onPage?: (deltaS: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [page, setPage] = useState<Page | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const dragRef = useRef<{ x0: number; t0: number; moved: boolean; channel: string | null } | null>(null);

  // Drag-select past either edge of the page keeps going: the page turns at a
  // rate set by how far past the edge the pointer is (0.3 – 3 pages/s), in
  // steps of an eighth of a page so the reader is not asked for a new window
  // every frame. The selection end rides the edge that is being pulled.
  const autoRef = useRef<{ side: 1 | -1; overshoot: number; timer: number; last: number; acc: number } | null>(null);
  const stopAuto = () => {
    if (autoRef.current) { window.clearInterval(autoRef.current.timer); autoRef.current = null; }
  };
  const autoScroll = (side: 1 | -1, overshoot: number) => {
    if (!onPage) return;
    if (autoRef.current) { autoRef.current.side = side; autoRef.current.overshoot = overshoot; return; }
    const st = { side, overshoot, timer: 0, last: performance.now(), acc: 0 };
    // an interval, not requestAnimationFrame: the drag must keep paging even
    // when the tab is throttled and frames stop
    st.timer = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.2, (now - st.last) / 1000);
      st.last = now;
      const pagesPerS = Math.min(3, 0.3 + st.overshoot / 80);
      st.acc += st.side * pagesPerS * pageS * dt;
      const step = pageS / 8;
      if (Math.abs(st.acc) >= step) {
        const move = Math.trunc(st.acc / step) * step;
        st.acc -= move;
        onPage(move);
      }
    }, 40);
    autoRef.current = st;
  };
  useEffect(() => stopAuto, []);
  useEffect(() => {
    const a = autoRef.current, d = dragRef.current;
    if (a && d) setDrag({ a: d.t0, b: a.side > 0 ? t0 + pageS : t0 });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the selection end follows the page while auto-scrolling
  }, [t0, pageS]);

  // ── size ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(200, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── fetch + filter ──────────────────────────────────────────────────────
  const filterKey = `${filters.highPassHz}|${filters.lowPassHz}|${filters.notchHz}`;
  useEffect(() => {
    let cancelled = false;
    onLoading?.(true);
    const margin = settlingMarginS(filters);
    const from = Math.max(0, t0 - margin);
    reader.readWindow(from, t0 + pageS).then((win) => {
      if (cancelled) return;
      const chain = designChain(win.sampleRate, filters);
      const skip = Math.round((t0 - win.t0) * win.sampleRate);
      const rows = win.data.map((r) => applyChain(Float32Array.from(r), chain).subarray(skip));
      setPage({ t0, fs: win.sampleRate, rows, fileAnnotations: win.annotations });
    }).catch((e) => {
      console.error("[viewer] page read failed:", e);
    }).finally(() => { if (!cancelled) onLoading?.(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader, t0, pageS, filterKey]);

  const derived = useMemo(() => {
    if (!page) return null;
    return applyMontage(page.rows, reader.labels, derivations);
  }, [page, derivations, reader]);

  // ── layout ──────────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    const slots: number[] = [];
    let y = 0;
    let firstAux = true;
    derivations.forEach((d) => {
      if (d.aux && firstAux) { y += 0.6; firstAux = false; }
      slots.push(y + 0.5);
      y += 1;
      if (d.chainEnd) y += 0.5;
    });
    const rowH = (size.h - AXIS_H - 8) / Math.max(1, y);
    return { rowH, centres: slots.map((s) => AXIS_H + s * rowH) };
  }, [derivations, size.h]);

  // ── paint ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr; canvas.height = size.h * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(canvas);
    const col = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const bg = col("--bg-card", "#111"), grid = col("--border", "#333"), text = col("--text-muted", "#999");
    const trace = col("--text", "#eee"), accent = col("--accent-primary", "#4cc9b0");

    ctx.fillStyle = bg; ctx.fillRect(0, 0, size.w, size.h);
    const plotW = size.w - GUTTER - 8;
    const xOf = (t: number) => GUTTER + ((t - t0) / pageS) * plotW;

    // time grid: one line per second, labels every 1 or 2 s
    ctx.font = "11px var(--mono-font, monospace)";
    ctx.textBaseline = "top";
    const labelEvery = pageS > 20 ? 5 : pageS > 12 ? 2 : 1;
    for (let s = Math.ceil(t0); s <= t0 + pageS; s++) {
      const x = xOf(s);
      ctx.strokeStyle = grid; ctx.lineWidth = s % labelEvery === 0 ? 1 : 0.5;
      ctx.beginPath(); ctx.moveTo(x, AXIS_H); ctx.lineTo(x, size.h); ctx.stroke();
      if (s % labelEvery === 0) { ctx.fillStyle = text; ctx.textAlign = "center"; ctx.fillText(formatClock(s), x, 3); }
    }

    // channel labels
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    derivations.forEach((d, i) => {
      ctx.fillStyle = d.aux ? text : trace;
      ctx.fillText(d.label, GUTTER - 8, layout.centres[i]);
    });

    // answer-key spans (instructor overlay) behind the traces
    for (const a of answerSpans) {
      const x0 = Math.max(GUTTER, xOf(a.onsetS)), x1 = Math.min(size.w, xOf(a.offsetS));
      if (x1 <= GUTTER || x0 >= size.w) continue;
      ctx.fillStyle = "rgba(229,72,77,0.10)"; ctx.fillRect(x0, AXIS_H, x1 - x0, size.h - AXIS_H);
      // bottom-left of the span, clear of the file-annotation labels at the top
      ctx.fillStyle = "#e5484d"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`KEY · ${a.label}`, x0 + 4, size.h - 18);
    }

    // user annotations
    for (const a of annotations) {
      const x0 = xOf(a.onsetS), x1 = xOf(a.onsetS + a.durationS);
      if (x1 < GUTTER || x0 > size.w) continue;
      const c = annotationColor(a.kind);
      if (a.durationS > 0) { ctx.fillStyle = c + "22"; ctx.fillRect(Math.max(GUTTER, x0), AXIS_H, Math.min(size.w, x1) - Math.max(GUTTER, x0), size.h - AXIS_H); }
      ctx.strokeStyle = c; ctx.lineWidth = a.mine ? 1.5 : 1; ctx.setLineDash(a.mine ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, AXIS_H); ctx.lineTo(x0, size.h); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = c; ctx.textAlign = "left"; ctx.textBaseline = "top";
      // the span stays full height — the target is named in the caption instead
      const target = describeTarget(a);
      ctx.fillText(`${a.label || a.kind}${target ? ` · ${target}` : ""}`, x0 + 4, size.h - 14);
    }

    // file annotations (bedside)
    if (page) {
      for (const a of page.fileAnnotations) {
        const x = xOf(a.onsetS);
        if (x < GUTTER || x > size.w) continue;
        ctx.strokeStyle = accent; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, AXIS_H); ctx.lineTo(x, size.h); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = accent; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(a.text, x + 4, AXIS_H + 16);
      }
    }

    // traces
    if (derived && page) {
      const pxPerUv = PX_PER_MM / sensitivityUvPerMm;
      const pxPerUvAux = PX_PER_MM / auxSensitivityUvPerMm;
      const n = derived[0]?.length ?? 0;
      // Draw at device resolution. Below ~2 samples per device pixel every
      // sample is a vertex; above it each pixel column gets its min and max,
      // so a spike is never dropped by decimation the way "every k-th sample"
      // drops it (visible at 30–60 s/page on a long record).
      const cols = Math.max(1, Math.floor(plotW * dpr));
      const perCol = n / cols;
      const envelope = perCol > 2;
      ctx.lineWidth = penWidth;
      ctx.lineJoin = "round";
      derived.forEach((row, i) => {
        const cy = layout.centres[i];
        const gain = derivations[i].aux ? pxPerUvAux : pxPerUv;
        ctx.strokeStyle = derivations[i].aux ? text : trace;
        ctx.beginPath();
        if (!envelope) {
          for (let k = 0; k < n; k++) {
            const x = GUTTER + (k / n) * plotW;
            const y = cy - row[k] * gain;
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
        } else {
          for (let c = 0; c < cols; c++) {
            const k0 = Math.floor(c * perCol), k1 = Math.min(n, Math.max(k0 + 1, Math.floor((c + 1) * perCol)));
            let lo = Infinity, hi = -Infinity;
            for (let k = k0; k < k1; k++) { const v = row[k]; if (v < lo) lo = v; if (v > hi) hi = v; }
            if (lo === Infinity) continue;
            const x = GUTTER + (c + 0.5) / dpr;
            const yA = cy - (c % 2 === 0 ? hi : lo) * gain, yB = cy - (c % 2 === 0 ? lo : hi) * gain;
            if (c === 0) ctx.moveTo(x, yA); else ctx.lineTo(x, yA);
            ctx.lineTo(x, yB);
          }
        }
        ctx.stroke();
      });
      // scale bar: 100 µV
      const barPx = 100 * pxPerUv;
      ctx.strokeStyle = text; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(size.w - 5, size.h - 8); ctx.lineTo(size.w - 5, size.h - 8 - barPx); ctx.stroke();
      ctx.fillStyle = text; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.font = "10px var(--mono-font, monospace)";
      ctx.fillText("100 µV", size.w - 8, size.h - 8 - barPx / 2);
    }

    // drag selection (may extend past this page while auto-scrolling)
    if (drag) {
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      const x0 = Math.max(GUTTER, xOf(a)), x1 = Math.min(size.w, xOf(b));
      if (x1 > x0) {
        ctx.fillStyle = "rgba(76,201,176,0.15)"; ctx.fillRect(x0, AXIS_H, x1 - x0, size.h - AXIS_H);
        ctx.fillStyle = accent; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "11px var(--mono-font, monospace)";
        ctx.fillText(`${formatClock(a)} – ${formatClock(b)} · ${(b - a).toFixed(1)} s`, x0 + 4, AXIS_H + 3);
      }
    }

    // cursor
    if (cursorT !== null && cursorT >= t0 && cursorT <= t0 + pageS) {
      const x = xOf(cursorT);
      ctx.strokeStyle = accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.h); ctx.stroke();
    }
  }, [derived, page, derivations, layout, size, sensitivityUvPerMm, auxSensitivityUvPerMm, annotations, answerSpans, cursorT, drag, t0, pageS, theme, penWidth]);

  // ── wheel = paging ──────────────────────────────────────────────────────
  // Non-passive so the document does not scroll while the page turns.
  const wheelAcc = useRef(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !onPage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? (e.deltaY || e.deltaX) * 20 : (e.deltaY || e.deltaX);
      wheelAcc.current += delta;
      const notches = Math.trunc(wheelAcc.current / WHEEL_NOTCH_PX);
      if (!notches) return;
      wheelAcc.current -= notches * WHEEL_NOTCH_PX;
      onPage(notches * (e.shiftKey ? 1 : pageS));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onPage, pageS]);

  // ── pointer ─────────────────────────────────────────────────────────────
  const timeAt = (clientX: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const frac = (clientX - r.left - GUTTER) / (size.w - GUTTER - 8);
    return Math.min(t0 + pageS, Math.max(t0, t0 + frac * pageS));
  };
  /** the derivation whose trace band the press landed in — nearest centre wins */
  const channelAt = (clientY: number): string | null => {
    const r = canvasRef.current!.getBoundingClientRect();
    const y = clientY - r.top;
    let best = -1, bestD = Infinity;
    layout.centres.forEach((cy, i) => { const d = Math.abs(cy - y); if (d < bestD) { bestD = d; best = i; } });
    return best < 0 ? null : derivations[best].label;
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: "block", cursor: "crosshair", touchAction: "pan-y" }}
        onPointerCancel={() => { stopAuto(); dragRef.current = null; setDrag(null); }}
        onPointerDown={(e) => {
          if (e.clientX - canvasRef.current!.getBoundingClientRect().left < GUTTER) return;
          const t = timeAt(e.clientX);
          dragRef.current = { x0: e.clientX, t0: t, moved: false, channel: channelAt(e.clientY) };
          try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x0) > 4) d.moved = true;
          if (!d.moved) return;
          const r = canvasRef.current!.getBoundingClientRect();
          const left = r.left + GUTTER, right = r.right - 8;
          if (e.clientX > right) autoScroll(1, e.clientX - right);
          else if (e.clientX < left) autoScroll(-1, left - e.clientX);
          else stopAuto();
          setDrag({ a: d.t0, b: timeAt(e.clientX) });
        }}
        onPointerUp={(e) => {
          stopAuto();
          const d = dragRef.current;
          dragRef.current = null;
          if (!d) return;
          if (d.moved) {
            const t1 = timeAt(e.clientX);
            setDrag(null);
            onSelect(Math.min(d.t0, t1), Math.max(d.t0, t1), d.channel);
          } else {
            onCursor(d.t0, d.channel);
          }
        }}
      />
    </div>
  );
}
