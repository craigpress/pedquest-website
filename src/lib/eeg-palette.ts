// Client-side heat-map palette swapping for rendered qEEG images.
//
// The renderer bakes one colour map ("pedquest_power", tools/eeg-render/
// eeg_render/style.py) into the spectrogram / rhythmicity panels of every
// PNG. Learners trained on other trend software often read a different
// palette more fluently, so the viewer lets them pick one. We invert the
// known source LUT pixel-by-pixel inside the panel rectangles the render
// sidecar reports, and re-map to the chosen LUT. Pixels that are not on the
// source ramp (labels, grid, cursors, the asymmetry panels) are left alone.

import type { ImagePanel } from "@/lib/cases";

export type PaletteId = "pedquest" | "rainbow" | "viridis" | "gray";

export interface Palette {
  id: PaletteId;
  label: string;
  hint: string;
  stops: [number, string][];
}

// Must match LinearSegmentedColormap.from_list("pedquest_power", …) exactly —
// matplotlib interpolates linearly in RGB, and so do we.
const PEDQUEST_STOPS: [number, string][] = [
  [0.00, "#02040b"], [0.14, "#15103b"], [0.34, "#43206f"], [0.55, "#8f315f"],
  [0.73, "#df6248"], [0.88, "#f4ad59"], [1.00, "#fff1bd"],
];

export const PALETTES: Palette[] = [
  { id: "pedquest", label: "PedQuEST", hint: "Default cool-to-warm power scale", stops: PEDQUEST_STOPS },
  {
    id: "rainbow", label: "Rainbow (classic)",
    hint: "Black → blue → green → yellow → red → white, as in common bedside trend software",
    stops: [
      [0.00, "#000000"], [0.12, "#00007f"], [0.26, "#0000ff"], [0.40, "#00c8ff"],
      [0.52, "#00ff00"], [0.68, "#ffff00"], [0.84, "#ff0000"], [1.00, "#ffffff"],
    ],
  },
  {
    id: "viridis", label: "Viridis", hint: "Perceptually uniform, colour-blind friendly",
    stops: [
      [0.000, "#440154"], [0.125, "#48186a"], [0.250, "#472d7b"], [0.375, "#3b528b"],
      [0.500, "#2c728e"], [0.625, "#21918c"], [0.750, "#28ae80"], [0.875, "#5ec962"], [1.000, "#fde725"],
    ],
  },
  { id: "gray", label: "Grayscale", hint: "Black → white", stops: [[0, "#000000"], [1, "#ffffff"]] },
];

export const DEFAULT_PALETTE: PaletteId = "pedquest";
export const PALETTE_STORAGE_KEY = "pedquest_eeg_palette";

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === "string" && PALETTES.some((p) => p.id === v);
}

export function loadPalettePreference(): PaletteId {
  try {
    const v = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPaletteId(v) ? v : DEFAULT_PALETTE;
  } catch { return DEFAULT_PALETTE; }
}
export function savePalettePreference(id: PaletteId): void {
  try { localStorage.setItem(PALETTE_STORAGE_KEY, id); } catch { /* ignore */ }
}

/** Panels whose pixels are drawn with the spectrogram colour map. */
const HEAT_PANELS = new Set(["fft_L", "fft_R", "rhythmicity_L", "rhythmicity_R"]);

interface Rect { x0: number; y0: number; x1: number; y1: number }

/**
 * Image-fraction rectangles that carry heat-map pixels. Raw EEG pages may
 * carry a trend strip under the traces; its geometry is not in the sidecar,
 * so we take the band below the last row — only ramp-coloured pixels change.
 */
export function heatRegions(kind: string | null, panels: ImagePanel[]): Rect[] {
  const rects: Rect[] = [];
  let lastRowY1 = 0;
  for (const p of panels) {
    if (p.name && HEAT_PANELS.has(p.name) && p.x0 != null && p.x1 != null && p.y0 != null && p.y1 != null) {
      rects.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    }
    if (p.label && p.y1 != null && p.name == null) lastRowY1 = Math.max(lastRowY1, p.y1);
  }
  if (kind === "eeg_page" && lastRowY1 > 0 && lastRowY1 < 0.97) {
    rects.push({ x0: 0.04, y0: Math.min(0.99, lastRowY1 + 0.004), x1: 0.995, y1: 0.99 });
  }
  return rects;
}

export function hasHeatRegions(kind: string | null, panels: ImagePanel[]): boolean {
  return heatRegions(kind, panels).length > 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 256-entry RGB lookup table, linear interpolation between stops (matplotlib semantics). */
export function buildLut(stops: [number, string][]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  const rgb = stops.map(([pos, hex]) => ({ pos, c: hexToRgb(hex) }));
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < rgb.length - 2 && t > rgb[k + 1].pos) k++;
    const a = rgb[k], b = rgb[k + 1];
    const f = b.pos === a.pos ? 0 : Math.min(1, Math.max(0, (t - a.pos) / (b.pos - a.pos)));
    for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = Math.round(a.c[ch] + (b.c[ch] - a.c[ch]) * f);
  }
  return lut;
}

// Squared RGB distance within which a pixel counts as "on the source ramp".
// Adjacent LUT entries differ by only a few units, so genuine heat-map pixels
// (including antialiased blends of neighbouring values) sit well inside this;
// the page ink (#111111) and panel text/grid colours sit well outside it.
const MATCH_DIST2 = 260;

/**
 * Re-map the heat-map regions of a rendered image from the PedQuEST palette to
 * `target`. Resolves to an object URL for the recoloured PNG; "noop" when the
 * regions held no ramp-coloured pixels (e.g. a raw page without a trend strip);
 * null when the image cannot be read (e.g. no CORS headers) — the caller then
 * keeps the original. The image must have been loaded with crossOrigin="anonymous".
 */
export async function recolorImage(
  img: HTMLImageElement,
  regions: Rect[],
  target: PaletteId,
): Promise<string | "noop" | null> {
  if (target === DEFAULT_PALETTE || regions.length === 0) return "noop";
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  const src = buildLut(PEDQUEST_STOPS);
  const dst = buildLut(PALETTES.find((p) => p.id === target)!.stops);
  // 6 bits per channel → 262 144 buckets; 0 = unknown, 1..256 = LUT index + 1, -1 = no match
  const cache = new Int16Array(1 << 18);
  let changed = 0;

  const nearest = (r: number, g: number, b: number): number => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache[key];
    if (hit !== 0) return hit;
    let best = -1, bestD = MATCH_DIST2 + 1;
    for (let i = 0; i < 256; i++) {
      const dr = src[i * 3] - r, dg = src[i * 3 + 1] - g, db = src[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    const val = best < 0 ? -1 : best + 1;
    cache[key] = val;
    return val;
  };

  for (const rg of regions) {
    const x0 = Math.max(0, Math.floor(rg.x0 * w)), x1 = Math.min(w, Math.ceil(rg.x1 * w));
    const y0 = Math.max(0, Math.floor(rg.y0 * h)), y1 = Math.min(h, Math.ceil(rg.y1 * h));
    if (x1 <= x0 || y1 <= y0) continue;
    let data: ImageData;
    try { data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0); } catch { return null; } // tainted canvas
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const m = nearest(px[i], px[i + 1], px[i + 2]);
      if (m > 0) {
        const j = (m - 1) * 3;
        px[i] = dst[j]; px[i + 1] = dst[j + 1]; px[i + 2] = dst[j + 2];
        changed++;
      }
    }
    ctx.putImageData(data, x0, y0);
  }

  // Fewer than a sliver of pixels means there was no heat map here at all.
  if (changed < 500) return "noop";
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/png");
  });
}
