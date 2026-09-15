// Montage derivations for the viewer. A derivation is (positive, negative)
// label pairs; the pane paints positive minus negative, negative-up.
//
// Naming follows ACNS Guideline 3 where a code exists (LB-18.3, TB-18.3,
// R-18.3). Local synonyms are pinned to one definition each:
//   circumferential = hatband = the outer temporal ring
//   grapefruit      = outer temporal ring + inner parasagittal ring + midline
// Laplacian is the Hjorth nearest-neighbour form (equal weights).

export type ViewerMontageId =
  | "as_recorded"
  | "longitudinal_bipolar"
  | "transverse_bipolar"
  | "circumferential"
  | "grapefruit"
  | "t1t2_bipolar"
  | "average"
  | "ipsilateral_ear"
  | "contralateral_ear"
  | "cz_reference"
  | "neonatal"
  | "neonatal_average"
  | "laplacian";

export type MontageGroup = "Bipolar" | "Referential" | "Neonatal" | "Special";

export interface ViewerMontage {
  id: ViewerMontageId;
  label: string;
  group: MontageGroup;
  /** electrode labels (normalised) that must be present in the recording */
  requires?: string[];
}

export interface Derivation {
  label: string;
  /** channel indices into the recording's data signals */
  plus: number;
  /** -1 = the recorded reference; -2 = common average of EEG channels */
  minus: number;
  /** when set, the reference is the mean of these channel indices (overrides `minus`) */
  ref?: number[];
  /** visual grouping: a gap is painted after the last channel of a chain */
  chainEnd?: boolean;
  /** true for non-EEG rows (EKG, ear electrodes) painted below the EEG */
  aux?: boolean;
}

export const VIEWER_MONTAGES: ViewerMontage[] = [
  { id: "longitudinal_bipolar", label: "Longitudinal bipolar (LB-18.3)", group: "Bipolar" },
  { id: "transverse_bipolar", label: "Transverse bipolar (TB-18.3)", group: "Bipolar" },
  { id: "circumferential", label: "Circumferential (hatband)", group: "Bipolar" },
  { id: "grapefruit", label: "Grapefruit (concentric rings)", group: "Bipolar" },
  { id: "t1t2_bipolar", label: "Longitudinal with T1/T2", group: "Bipolar", requires: ["T1", "T2"] },
  { id: "average", label: "Average reference", group: "Referential" },
  { id: "ipsilateral_ear", label: "Ipsilateral ear (R-18.3)", group: "Referential", requires: ["A1", "A2"] },
  { id: "contralateral_ear", label: "Contralateral ear", group: "Referential", requires: ["A1", "A2"] },
  { id: "cz_reference", label: "Cz reference", group: "Referential", requires: ["Cz"] },
  { id: "as_recorded", label: "As recorded", group: "Referential" },
  { id: "neonatal", label: "Neonatal bipolar (reduced)", group: "Neonatal" },
  { id: "neonatal_average", label: "Neonatal, average reference", group: "Neonatal" },
  { id: "laplacian", label: "Laplacian (source)", group: "Special" },
];

export const MONTAGE_GROUPS: MontageGroup[] = ["Bipolar", "Referential", "Neonatal", "Special"];

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

/** Outer temporal ring, left front → back, right back → front, closed at Fp. */
const OUTER_RING: string[] = ["Fp1", "F7", "T3", "T5", "O1", "O2", "T6", "T4", "F8", "Fp2", "Fp1"];
/** Inner parasagittal ring, same direction. */
const INNER_RING: string[] = ["Fp1", "F3", "C3", "P3", "O1", "O2", "P4", "C4", "F4", "Fp2", "Fp1"];

const CIRCUMFERENTIAL: string[][] = [OUTER_RING];
const GRAPEFRUIT: string[][] = [OUTER_RING, INNER_RING, ["Fz", "Cz", "Pz"]];

/** Double banana with the subtemporal electrodes spliced into the temporal chains. */
const T1T2: string[][] = [
  ["Fp1", "F7", "T1", "T3", "T5", "O1"],
  ["Fp2", "F8", "T2", "T4", "T6", "O2"],
  ["Fp1", "F3", "C3", "P3", "O1"],
  ["Fp2", "F4", "C4", "P4", "O2"],
  ["Fz", "Cz", "Pz"],
];

const NEONATAL: string[][] = [
  ["Fp1", "C3", "O1"],
  ["Fp2", "C4", "O2"],
  ["Fp1", "T3", "O1"],
  ["Fp2", "T4", "O2"],
  ["T3", "C3", "Cz", "C4", "T4"],
];

/** Referential row order: temporal chains, parasagittal chains, midline. */
const REFERENTIAL_ORDER: string[][] = [
  ["Fp1", "F7", "T3", "T5", "O1"],
  ["Fp2", "F8", "T4", "T6", "O2"],
  ["F3", "C3", "P3"],
  ["F4", "C4", "P4"],
  ["Fz", "Cz", "Pz"],
];

const NEONATAL_ELECTRODES: string[][] = [
  ["Fp1", "T3", "C3", "O1"],
  ["Fp2", "T4", "C4", "O2"],
  ["Cz"],
];

/** Hjorth nearest neighbours on the 10-20 grid. Edge electrodes have fewer
 *  neighbours, so their source estimate is one-sided. */
const LAPLACIAN_NEIGHBOURS: Record<string, string[]> = {
  Fp1: ["Fp2", "F3", "F7"], Fp2: ["Fp1", "F4", "F8"],
  F7: ["Fp1", "F3", "T3"], F8: ["Fp2", "F4", "T4"],
  F3: ["Fp1", "F7", "Fz", "C3"], F4: ["Fp2", "F8", "Fz", "C4"],
  Fz: ["F3", "F4", "Cz"],
  T3: ["F7", "C3", "T5"], T4: ["F8", "C4", "T6"],
  C3: ["F3", "T3", "P3", "Cz"], C4: ["F4", "T4", "P4", "Cz"],
  Cz: ["Fz", "C3", "C4", "Pz"],
  T5: ["T3", "P3", "O1"], T6: ["T4", "P4", "O2"],
  P3: ["C3", "T5", "Pz", "O1"], P4: ["C4", "T6", "Pz", "O2"],
  Pz: ["P3", "P4", "Cz"],
  O1: ["T5", "P3", "O2"], O2: ["T6", "P4", "O1"],
};

/** Labels treated as non-scalp rows. Matched case-insensitively on the
 *  leading token so "EKG", "ECG", "EKG-Ref" all qualify. */
const AUX_RE = /^(ekg|ecg|emg|eog|resp|sao2|spo2|a1|a2|m1|m2)\b/i;
/** Modern names for the 10-20 temporal electrodes map onto the classic ones;
 *  FT9/FT10 stand in for the Silverman subtemporal pair T1/T2. */
const ALIASES: Record<string, string> = { T7: "T3", T8: "T4", P7: "T5", P8: "T6", FT9: "T1", FT10: "T2" };

function norm(label: string): string {
  const base = label.replace(/^EEG\s*/i, "").split(/[-\s]/)[0];
  return ALIASES[base.toUpperCase()] ?? base;
}

function indexOf(labels: string[]): Map<string, number> {
  const m = new Map<string, number>();
  labels.forEach((l, i) => { const k = norm(l).toLowerCase(); if (!m.has(k)) m.set(k, i); });
  return m;
}

/** Electrodes from `requires` that the recording lacks; empty when available. */
export function missingElectrodes(montage: ViewerMontage, labels: string[]): string[] {
  if (!montage.requires) return [];
  const idx = indexOf(labels);
  return montage.requires.filter((e) => !idx.has(e.toLowerCase()));
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

function isLeft(electrode: string): boolean | null {
  const m = /(\d+)$/.exec(electrode);
  return m ? parseInt(m[1], 10) % 2 === 1 : null; // null = midline
}

/** Referential rows in canonical order; `refFor` returns the reference for an
 *  electrode, or null to drop that row. Electrodes not in the canonical order
 *  (extra 10-10 leads) follow in file order. */
function referential(
  order: string[][],
  labels: string[],
  suffix: string,
  refFor: (electrode: string, index: number) => (Pick<Derivation, "minus" | "ref"> & { suffix?: string }) | null,
): Derivation[] {
  const idx = indexOf(labels);
  const used = new Set<number>();
  const out: Derivation[] = [];
  for (const chain of order) {
    const rows: Derivation[] = [];
    for (const e of chain) {
      const i = idx.get(e.toLowerCase());
      if (i === undefined) continue;
      used.add(i);
      const r = refFor(e, i);
      if (!r) continue;
      rows.push(row(e, i, r));
    }
    if (rows.length) { rows[rows.length - 1].chainEnd = true; out.push(...rows); }
  }
  labels.forEach((l, i) => {
    const n = norm(l);
    if (used.has(i) || AUX_RE.test(n)) return;
    const r = refFor(n, i);
    if (r) out.push(row(n, i, r));
  });
  return out;

  function row(e: string, i: number, r: Pick<Derivation, "minus" | "ref"> & { suffix?: string }): Derivation {
    const { suffix: s, ...rest } = r;
    return { label: `${e}${s ?? suffix}`, plus: i, ...rest };
  }
}

export function buildMontage(id: ViewerMontageId, labels: string[]): Derivation[] {
  const aux = auxRows(labels);
  const eeg = labels.map((l, i) => ({ l, i })).filter(({ l }) => !AUX_RE.test(norm(l)));
  const idx = indexOf(labels);
  const bipolar = (chains: string[][]) => {
    const rows = fromChains(chains, labels);
    return rows.length ? [...rows, ...aux] : buildMontage("as_recorded", labels);
  };
  switch (id) {
    case "longitudinal_bipolar": return bipolar(DOUBLE_BANANA);
    case "transverse_bipolar": return bipolar(TRANSVERSE);
    case "circumferential": return bipolar(CIRCUMFERENTIAL);
    case "grapefruit": return bipolar(GRAPEFRUIT);
    case "t1t2_bipolar": return bipolar(T1T2);
    case "neonatal": return bipolar(NEONATAL);
    case "average":
      return [...referential(REFERENTIAL_ORDER, labels, "-Av", () => ({ minus: -2 })), ...aux];
    case "ipsilateral_ear":
    case "contralateral_ear": {
      const a1 = idx.get("a1"); const a2 = idx.get("a2");
      if (a1 === undefined || a2 === undefined) return buildMontage("average", labels);
      const ipsi = id === "ipsilateral_ear";
      return [
        ...referential(REFERENTIAL_ORDER, labels, "", (e) => {
          const left = isLeft(e);
          if (left === null) return { minus: -1, ref: [a1, a2], suffix: "-A12" }; // midline: linked ears
          const ear = left === ipsi ? a1 : a2;
          return { minus: ear, suffix: ear === a1 ? "-A1" : "-A2" };
        }),
        ...aux,
      ];
    }
    case "cz_reference": {
      const cz = idx.get("cz");
      if (cz === undefined) return buildMontage("average", labels);
      return [...referential(REFERENTIAL_ORDER, labels, "-Cz", (_e, i) => (i === cz ? null : { minus: cz })), ...aux];
    }
    case "neonatal_average": {
      const members = NEONATAL_ELECTRODES.flat().map((e) => idx.get(e.toLowerCase())).filter((i): i is number => i !== undefined);
      if (!members.length) return buildMontage("average", labels);
      const set = new Set(members);
      const rows = referential(NEONATAL_ELECTRODES, labels, "-Av", (_e, i) => (set.has(i) ? { minus: -1, ref: members } : null));
      return [...rows, ...aux];
    }
    case "laplacian": {
      const rows = referential(REFERENTIAL_ORDER, labels, "-Lp", (e) => {
        const nb = (LAPLACIAN_NEIGHBOURS[e] ?? []).map((n) => idx.get(n.toLowerCase())).filter((i): i is number => i !== undefined);
        return nb.length >= 2 ? { minus: -1, ref: nb } : null;
      });
      return rows.length ? [...rows, ...aux] : buildMontage("average", labels);
    }
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
  if (derivations.some((d) => d.minus === -2 && !d.ref)) {
    const members = averageMembers(labels);
    avg = new Float32Array(n);
    for (const m of members) { const r = rows[m]; for (let i = 0; i < n; i++) avg[i] += r[i]; }
    const k = members.length || 1;
    for (let i = 0; i < n; i++) avg[i] /= k;
  }
  const meanCache = new Map<string, Float32Array>();
  const meanOf = (ref: number[]): Float32Array => {
    const key = ref.join(",");
    let m = meanCache.get(key);
    if (m) return m;
    m = new Float32Array(n);
    for (const j of ref) { const r = rows[j]; for (let i = 0; i < n; i++) m[i] += r[i]; }
    const k = ref.length || 1;
    for (let i = 0; i < n; i++) m[i] /= k;
    meanCache.set(key, m);
    return m;
  };
  return derivations.map((d) => {
    const a = rows[d.plus];
    if (d.ref) {
      const b = meanOf(d.ref);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
      return out;
    }
    if (d.minus === -1) return a;
    const b = d.minus === -2 ? avg! : rows[d.minus];
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
    return out;
  });
}
