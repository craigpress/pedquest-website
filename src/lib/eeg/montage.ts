// Montage derivations for the viewer. A derivation is (positive, negative)
// label pairs; the pane paints positive minus negative, negative-up.

export type ViewerMontageId = "as_recorded" | "longitudinal_bipolar" | "transverse_bipolar" | "average" | "neonatal";

export interface Derivation {
  label: string;
  /** channel indices into the recording's data signals */
  plus: number;
  /** -1 = the recorded reference; -2 = common average of EEG channels */
  minus: number;
  /** visual grouping: a gap is painted after the last channel of a chain */
  chainEnd?: boolean;
  /** true for non-EEG rows (EKG, ear electrodes) painted below the EEG */
  aux?: boolean;
}

export const VIEWER_MONTAGES: { id: ViewerMontageId; label: string }[] = [
  { id: "longitudinal_bipolar", label: "Longitudinal bipolar" },
  { id: "transverse_bipolar", label: "Transverse bipolar" },
  { id: "average", label: "Average reference" },
  { id: "as_recorded", label: "As recorded (referential)" },
  { id: "neonatal", label: "Neonatal (reduced)" },
];

const DOUBLE_BANANA: string[][] = [
  ["Fp1", "F7", "T3", "T5", "O1"],
  ["Fp2", "F8", "T4", "T6", "O2"],
  ["Fp1", "F3", "C3", "P3", "O1"],
  ["Fp2", "F4", "C4", "P4", "O2"],
  ["Fz", "Cz", "Pz"],
];

const TRANSVERSE: string[][] = [
  ["F7", "Fp1", "Fp2", "F8"],
  ["F7", "F3", "Fz", "F4", "F8"],
  ["T3", "C3", "Cz", "C4", "T4"],
  ["T5", "P3", "Pz", "P4", "T6"],
  ["T5", "O1", "O2", "T6"],
];

const NEONATAL: string[][] = [
  ["Fp1", "C3", "O1"],
  ["Fp2", "C4", "O2"],
  ["Fp1", "T3", "O1"],
  ["Fp2", "T4", "O2"],
  ["T3", "C3", "Cz", "C4", "T4"],
];

/** Labels treated as non-scalp rows. Matched case-insensitively on the
 *  leading token so "EKG", "ECG", "EKG-Ref" all qualify. */
const AUX_RE = /^(ekg|ecg|emg|eog|resp|sao2|spo2|a1|a2|m1|m2)\b/i;
/** Modern names for the 10-20 temporal electrodes map onto the classic ones. */
const ALIASES: Record<string, string> = { T7: "T3", T8: "T4", P7: "T5", P8: "T6" };

function norm(label: string): string {
  const base = label.split(/[-\s]/)[0].replace(/^EEG\s*/i, "");
  return ALIASES[base] ?? base;
}

function indexOf(labels: string[]): Map<string, number> {
  const m = new Map<string, number>();
  labels.forEach((l, i) => { const k = norm(l).toLowerCase(); if (!m.has(k)) m.set(k, i); });
  return m;
}

function fromChains(chains: string[][], labels: string[]): Derivation[] {
  const idx = indexOf(labels);
  const out: Derivation[] = [];
  for (const chain of chains) {
    const rows: Derivation[] = [];
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = idx.get(chain[i].toLowerCase());
      const b = idx.get(chain[i + 1].toLowerCase());
      if (a === undefined || b === undefined) continue;
      rows.push({ label: `${chain[i]}-${chain[i + 1]}`, plus: a, minus: b });
    }
    if (rows.length) { rows[rows.length - 1].chainEnd = true; out.push(...rows); }
  }
  return out;
}

function auxRows(labels: string[]): Derivation[] {
  return labels
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => AUX_RE.test(norm(l)))
    .map(({ l, i }) => ({ label: norm(l), plus: i, minus: -1, aux: true }));
}

export function buildMontage(id: ViewerMontageId, labels: string[]): Derivation[] {
  const aux = auxRows(labels);
  const eeg = labels.map((l, i) => ({ l, i })).filter(({ l }) => !AUX_RE.test(norm(l)));
  switch (id) {
    case "longitudinal_bipolar": {
      const rows = fromChains(DOUBLE_BANANA, labels);
      return rows.length ? [...rows, ...aux] : buildMontage("as_recorded", labels);
    }
    case "transverse_bipolar": {
      const rows = fromChains(TRANSVERSE, labels);
      return rows.length ? [...rows, ...aux] : buildMontage("as_recorded", labels);
    }
    case "neonatal": {
      const rows = fromChains(NEONATAL, labels);
      return rows.length ? [...rows, ...aux] : buildMontage("as_recorded", labels);
    }
    case "average":
      return [...eeg.map(({ l, i }) => ({ label: `${norm(l)}-Av`, plus: i, minus: -2 })), ...aux];
    case "as_recorded":
    default:
      return [...eeg.map(({ l, i }) => ({ label: norm(l), plus: i, minus: -1 })), ...aux];
  }
}

/** Channel indices that enter the common average: scalp EEG only. */
export function averageMembers(labels: string[]): number[] {
  return labels.map((l, i) => ({ l, i })).filter(({ l }) => !AUX_RE.test(norm(l))).map(({ i }) => i);
}

/** Left/right hemisphere scalp channels, for the trend engine. */
export function hemisphereChannels(labels: string[]): { left: number[]; right: number[] } {
  const left: number[] = []; const right: number[] = [];
  labels.forEach((l, i) => {
    const n = norm(l);
    if (AUX_RE.test(n)) return;
    const m = /(\d+)$/.exec(n);
    if (!m) return; // midline (Fz, Cz, Pz) excluded
    (parseInt(m[1], 10) % 2 === 1 ? left : right).push(i);
  });
  return { left, right };
}

export function applyMontage(
  rows: Float32Array[],
  labels: string[],
  derivations: Derivation[],
): Float32Array[] {
  const n = rows[0]?.length ?? 0;
  let avg: Float32Array | null = null;
  if (derivations.some((d) => d.minus === -2)) {
    const members = averageMembers(labels);
    avg = new Float32Array(n);
    for (const m of members) { const r = rows[m]; for (let i = 0; i < n; i++) avg[i] += r[i]; }
    const k = members.length || 1;
    for (let i = 0; i < n; i++) avg[i] /= k;
  }
  return derivations.map((d) => {
    const a = rows[d.plus];
    if (d.minus === -1) return a;
    const b = d.minus === -2 ? avg! : rows[d.minus];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
    return out;
  });
}
