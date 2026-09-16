import { normalizeSpecInput } from "./spec";

type Json = Record<string, unknown>;

function isObj(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Convert a question-bank image into the single raw recording exported to the
 * EEG Lab. Composite images share one underlying recording, so their qEEG
 * child is flattened back into a qeeg_panel block.
 *
 * Term/near-term neonatal recordings use the full 10-20 acquisition. The
 * neonatal montage remains available as a display choice; it must not limit
 * which electrodes exist in the file. Reduced acquisition remains available
 * only for explicitly preterm recordings (<37 weeks PMA).
 */
export function qbankRecordingBlock(image: unknown): Json | null {
  const normalized = fullElectrodeNeonatalImage(image);
  if (!normalized || !isObj(normalized.spec)) return null;

  let block = clone(normalized);
  if (block.kind === "composite") {
    const parent = block.spec as Json;
    const panel = isObj(parent.qeeg_panel) ? parent.qeeg_panel : null;
    if (!panel) return null;
    const { layout: _layout, qeeg_panel: _panel, eeg_page: _page, ...shared } = parent;
    block = { ...block, kind: "qeeg_panel", spec: { ...shared, ...panel } };
  }

  return block;
}

/** Apply the acquisition policy without changing montage/display settings. */
export function fullElectrodeNeonatalImage(image: unknown): Json | null {
  const block = normalizeSpecInput(image);
  if (!block || !isObj(block.spec)) return null;
  const normalized = clone(block);
  const spec = normalized.spec as Json;
  const panel = normalized.kind === "composite" && isObj(spec.qeeg_panel) ? spec.qeeg_panel : spec;
  const background = isObj(panel.background) ? panel.background : {};
  const pma = typeof background.pma_weeks === "number" ? background.pma_weeks : null;
  if (spec.age_group === "neonate" && (pma === null || pma >= 37)) {
    spec.channels = "standard_19";
  }
  return normalized;
}

export function recordingDurationSeconds(block: Json): number {
  const spec = isObj(block.spec) ? block.spec : {};
  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  if (block.kind === "aeeg") return number(spec.duration_h, 6) * 3600;
  if (block.kind === "eeg_page" && spec.duration_min == null) {
    return number(spec.at_min, 0) * 60 + number(spec.window_s, 15) + 60;
  }
  return number(spec.duration_min, 240) * 60;
}
