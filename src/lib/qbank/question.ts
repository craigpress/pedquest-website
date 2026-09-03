// The question-bank content contract, in TypeScript.
//
// Mirrors content/qbank/schema/question.schema.json — that JSON Schema is the
// authority (scripts/qbank-validate.ts checks against it); this file is the
// typed view plus the mapping into the `eeg_cases` row shape used by the
// importer, the generation pipeline and the editor console.
//
// Framework-agnostic: no next/*, no React, no Supabase client. Safe to import
// from API routes AND from tsx scripts.

export interface QbankStem {
  vignette: string;
  image_caption: string;
  lead_in: string;
}

export interface QbankOption {
  key: "A" | "B" | "C" | "D" | "E";
  text: string;
  correct: boolean;
  rationale: string;
}

export interface QbankPointToFeature {
  instruction: string;
  target_event: number;
  target_panel: string;
  tolerance?: number;
}

export interface QbankReference {
  pmid?: string;
  doi?: string;
  isbn?: string;
  url?: string;
  citation: string;
  role: "primary" | "supporting";
  verified: boolean;
  verified_by?: string;
  open_access?: "cc-by" | "cc-by-nc" | "cc-by-nc-nd" | "pmc-oa" | "none" | "unknown";
  member_author?: boolean;
}

export interface QbankImage {
  kind: "qeeg_panel" | "eeg_page" | "aeeg" | "composite";
  license: "synthetic-original" | "dataset-derived" | "consortium" | "cc0" | "cc-by" | "cc-by-sa" | "public-domain";
  attribution?: string | null;
  spec: { seed: number } & Record<string, unknown>;
  rendered?: {
    path?: string;
    width?: number;
    height?: number;
    spec_hash?: string;
    renderer_version?: string;
  };
}

export interface QbankChecklist {
  cover_test: boolean;
  one_best_answer: boolean;
  numbers_sourced: boolean;
  pmids_verified: boolean;
  acns_terminology: boolean;
  spec_deterministic: boolean;
  no_copyright_reuse: boolean;
  deidentified: boolean;
  explanation_structure: boolean;
}

export interface QbankMetadata {
  author: string;
  model?: string;
  created: string;
  source_method: "literature-derived" | "expert-authored" | "ai-generated-pipeline";
  checklist: QbankChecklist;
  review?: {
    editor?: string | null;
    decision?: "approved" | "changes_requested" | "rejected" | null;
    notes?: string | null;
    decided_at?: string | null;
  };
}

export interface QbankQuestion {
  id: string;
  version: number;
  status: "draft" | "pending_review" | "approved" | "published" | "archived";
  title: string;
  domain: string;
  topics?: string[];
  population: string;
  setting: string;
  difficulty: "introductory" | "intermediate" | "advanced";
  bloom: "recall" | "interpretation" | "application" | "analysis";
  learning_objective: string;
  stem: QbankStem;
  question_type: "multiple_choice" | "point_to_feature";
  options: QbankOption[];
  point_to_feature?: QbankPointToFeature;
  explanation: string;
  key_points: string[];
  references: QbankReference[];
  image: QbankImage;
  metadata: QbankMetadata;
}

export const QBANK_ID_PATTERN = /^PQ-[A-Z]-[0-9]{3}$/;

/** Public path of a rendered bank image, by convention `<ID>.png`. */
export function imagePathForId(id: string): string {
  return `/images/qbank/${id}.png`;
}

/** Stable hash of an image spec, so an unchanged spec is not re-rendered. */
export function specHash(spec: unknown): string {
  const json = stableStringify(spec);
  // FNV-1a, 32-bit, hex. Deterministic across Node and the browser, and small
  // enough to eyeball in the editor console.
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** JSON with object keys sorted, so key order never changes the hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

// ---------------------------------------------------------------------------
// Mapping into the database
// ---------------------------------------------------------------------------

export interface CaseRowFields {
  qbank_id: string;
  title: string;
  domain: string;
  population: string;
  setting: string;
  bloom: string;
  difficulty: string;
  learning_objective: string;
  clinical_vignette: string;
  image_caption: string;
  lead_in: string;
  question_type: string;
  question_prompt: string;
  explanation: string;
  key_points: string[];
  teaching_points: string[];
  tags: string[];
  correct_region: unknown | null;
  region_tolerance: number | null;
  image_url: string;
  image_width: number | null;
  image_height: number | null;
  image_license: string;
  image_attribution: string | null;
  image_sidecar: unknown | null;
  spec: unknown;
  spec_hash: string;
  content: unknown;
  in_bank: boolean;
  source: string;
  version: number;
}

export interface OptionRowFields {
  label: string;
  is_correct: boolean;
  option_explanation: string;
  sort_order: number;
}

export interface ReferenceRowFields {
  pmid: string | null;
  doi: string | null;
  url: string | null;
  citation: string;
  role: string;
  verified: boolean;
  verified_by: string | null;
  open_access: string | null;
  member_author: boolean;
  sort_order: number;
}

/** The answer region for a point_to_feature item, taken from the sidecar the
 *  renderer produced. The writer never hand-draws it (STYLE_GUIDE §6). */
export function regionFromSidecar(sidecar: unknown): unknown | null {
  if (!sidecar || typeof sidecar !== "object") return null;
  const s = sidecar as Record<string, unknown>;
  const region = s.answer_region ?? s.region ?? null;
  return region && typeof region === "object" ? region : null;
}

/**
 * Convert a validated YAML question (plus its optional renderer sidecar) into
 * the row shapes the database expects. `content` keeps the whole question as a
 * snapshot so the editor can diff revisions.
 */
export function questionToRows(
  q: QbankQuestion,
  sidecar?: unknown,
): { case: CaseRowFields; options: OptionRowFields[]; references: ReferenceRowFields[] } {
  const side = sidecar ?? q.image.rendered ?? null;
  const dims = (side ?? {}) as Record<string, unknown>;

  return {
    case: {
      qbank_id: q.id,
      title: q.title,
      domain: q.domain,
      population: q.population,
      setting: q.setting,
      bloom: q.bloom,
      difficulty: q.difficulty,
      learning_objective: q.learning_objective,
      clinical_vignette: q.stem.vignette,
      image_caption: q.stem.image_caption,
      lead_in: q.stem.lead_in,
      question_type: q.question_type,
      // question_prompt is what the learner is asked; for point_to_feature the
      // instruction is the prompt, otherwise the lead-in is.
      question_prompt: q.question_type === "point_to_feature"
        ? (q.point_to_feature?.instruction ?? q.stem.lead_in)
        : q.stem.lead_in,
      explanation: q.explanation,
      key_points: q.key_points,
      // teaching_points powers the existing Case-of-the-Day reveal UI; the
      // bank's key_points are the same three bullets.
      teaching_points: q.key_points,
      tags: q.topics ?? [],
      correct_region: q.question_type === "point_to_feature" ? regionFromSidecar(side) : null,
      region_tolerance: q.question_type === "point_to_feature"
        ? (q.point_to_feature?.tolerance ?? 0.04)
        : null,
      image_url: imagePathForId(q.id),
      image_width: typeof dims.width === "number" ? dims.width : null,
      image_height: typeof dims.height === "number" ? dims.height : null,
      image_license: q.image.license,
      image_attribution: q.image.attribution ?? null,
      image_sidecar: side,
      spec: q.image.spec,
      spec_hash: specHash(q.image.spec),
      content: q,
      in_bank: true,
      source: q.metadata.source_method === "ai-generated-pipeline" ? "ai" : "team",
      version: q.version,
    },
    options: q.options.map((o, i) => ({
      label: o.text,
      is_correct: o.correct,
      option_explanation: o.rationale,
      sort_order: i,
    })),
    references: q.references.map((r, i) => ({
      pmid: r.pmid ?? null,
      doi: r.doi ?? null,
      url: r.url ?? null,
      citation: r.citation,
      role: r.role,
      verified: !!r.verified,
      verified_by: r.verified_by ?? null,
      open_access: r.open_access ?? null,
      member_author: !!r.member_author,
      sort_order: i,
    })),
  };
}

// ---------------------------------------------------------------------------
// Duplicate detection (used by the validator and the generator's critic)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or", "is", "are",
  "was", "were", "be", "been", "this", "that", "these", "those", "which", "what", "who",
  "his", "her", "its", "their", "you", "your", "most", "likely", "following", "best",
  "shows", "show", "shown", "next", "step", "after", "from", "by", "as", "has", "have",
]);

/** Content words of a stem, lowercased and de-duplicated. */
export function stemTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

/** Jaccard overlap of two stems, 0..1. ≥ 0.6 is a likely duplicate. */
export function stemSimilarity(a: string, b: string): number {
  const ta = stemTokens(a);
  const tb = stemTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export const DUPLICATE_THRESHOLD = 0.6;
