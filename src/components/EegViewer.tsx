"use client";

// Zoomable, scrollable frame for rendered EEG / qEEG images, with a heat-map
// palette picker. Timebase, sensitivity, filters and montage are baked into
// the PNG at render time (and stamped in its header), so those are not
// adjustable here; zoom and palette are.
//
// Children receive the src to display (the original URL, or a recoloured
// object URL when a non-default palette is active) so the point-to-feature
// overlay keeps working unchanged inside the zoomed frame.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ImagePanel } from "@/lib/cases";
import {
  DEFAULT_PALETTE, PALETTES, hasHeatRegions, heatRegions, loadPalettePreference,
  recolorImage, savePalettePreference, type PaletteId,
} from "@/lib/eeg-palette";

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 1.25;

export default function EegViewer({
  src,
  kind,
  panels,
  allowDragPan = true,
  protect = false,
  children,
}: {
  src: string;
  kind: string | null | undefined;
  panels: ImagePanel[] | undefined;
  /** drag to pan when zoomed in; off for click-to-mark images */
  allowDragPan?: boolean;
  /**
   * Deter casual copying on learner pages (right-click, drag-off, long-press
   * save). Deterrence only — a screenshot or devtools still gets the pixels,
   * and nothing in a browser can prevent that. Off in the editor console,
   * where saving a figure is legitimate.
   */
  protect?: boolean;
  children: (displaySrc: string) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [palette, setPalette] = useState<PaletteId>(DEFAULT_PALETTE);
  const [displaySrc, setDisplaySrc] = useState(src);
  const [paletteState, setPaletteState] = useState<"idle" | "working" | "unavailable" | "noop">("idle");
  const paletteEnabled = hasHeatRegions(kind ?? null, panels ?? []);

  // remembered palette (per browser)
  useEffect(() => { if (paletteEnabled) setPalette(loadPalettePreference()); }, [paletteEnabled]);

  // ---- recolour when the palette changes ----
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setDisplaySrc(src);
    if (!paletteEnabled || palette === DEFAULT_PALETTE) { setPaletteState("idle"); return; }
    setPaletteState("working");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      if (cancelled) return;
      setNaturalWidth(img.naturalWidth);
      const url = await recolorImage(img, heatRegions(kind ?? null, panels ?? []), palette);
      if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
      if (url === "noop") setPaletteState("noop");
      else if (url) { objectUrl = url; setDisplaySrc(url); setPaletteState("idle"); }
      else setPaletteState("unavailable");
    };
    img.onerror = () => { if (!cancelled) setPaletteState("unavailable"); };
    img.src = src;
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, palette, paletteEnabled, kind, panels]);

  // natural width for the 1:1 button (also set by the recolour path)
  useEffect(() => {
    const img = new Image();
    img.onload = () => setNaturalWidth(img.naturalWidth);
    img.src = src;
  }, [src]);

  // ---- zoom, keeping the viewport centre fixed ----
  const prevZoom = useRef(1);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const ratio = zoom / prevZoom.current;
    prevZoom.current = zoom;
    if (!el || ratio === 1) return;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
  }, [zoom]);

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_STEP));
  const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_STEP));
  const zoomFit = () => setZoom(1);
  const zoomActual = () => {
    const el = scrollRef.current;
    if (!el || !naturalWidth) return;
    setZoom(clampZoom(naturalWidth / el.clientWidth));
  };

  // ctrl/cmd + wheel (and trackpad pinch) zooms instead of scrolling the page
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---- drag to pan ----
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const canDrag = allowDragPan && zoom > 1;
  const onPointerDown = (e: React.PointerEvent) => {
    if (!canDrag || e.button !== 0) return;
    const el = scrollRef.current!;
    drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const el = scrollRef.current!;
    el.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
    el.scrollTop = drag.current.st - (e.clientY - drag.current.y);
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  const choosePalette = useCallback((id: PaletteId) => {
    setPalette(id);
    savePalettePreference(id);
  }, []);

  const btn: React.CSSProperties = {
    font: "inherit", fontFamily: "monospace", fontSize: 12, lineHeight: 1,
    padding: "5px 9px", borderRadius: 7, border: "1px solid var(--border)",
    background: "var(--bg-card)", color: "var(--text)", cursor: "pointer",
  };

  return (
    <div>
      <div
        role="toolbar"
        aria-label="Image tools"
        style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8,
          fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}
      >
        <button type="button" style={btn} onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out">−</button>
        <span style={{ minWidth: 42, textAlign: "center" }} aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" style={btn} onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in">+</button>
        <button type="button" style={btn} onClick={zoomFit} disabled={zoom === 1}>Fit</button>
        <button type="button" style={btn} onClick={zoomActual} disabled={!naturalWidth} title="Show at the rendered pixel size">1:1</button>
        <span style={{ opacity: 0.7 }}>· ctrl + scroll to zoom{canDrag ? ", drag to pan" : ""}</span>

        {paletteEnabled && (
          <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Heat map</span>
            <select
              value={palette}
              onChange={(e) => choosePalette(e.target.value as PaletteId)}
              style={{ ...btn, paddingRight: 6 }}
              title={PALETTES.find((p) => p.id === palette)?.hint}
            >
              {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {paletteState === "working" && <span aria-live="polite">…</span>}
            {paletteState === "unavailable" && (
              <span role="status" style={{ color: "var(--accent-primary)" }}>not available for this image</span>
            )}
            {paletteState === "noop" && (
              <span role="status">no heat-map panels in this image</span>
            )}
          </label>
        )}
      </div>

      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          overflow: "auto", maxHeight: zoom > 1 ? "80vh" : undefined,
          borderRadius: 14, cursor: canDrag ? (dragging ? "grabbing" : "grab") : undefined,
          touchAction: zoom > 1 ? "pan-x pan-y" : undefined,
        }}
      >
        <div
          style={{
            width: `${zoom * 100}%`, minWidth: "100%",
            ...(protect
              ? { userSelect: "none" as const, WebkitUserSelect: "none" as const,
                  WebkitTouchCallout: "none" as const }
              : {}),
          }}
          onContextMenu={protect ? (e) => e.preventDefault() : undefined}
          onDragStart={protect ? (e) => e.preventDefault() : undefined}
        >
          {children(displaySrc)}
        </div>
      </div>
    </div>
  );
}
