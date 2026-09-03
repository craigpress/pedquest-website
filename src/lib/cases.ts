// Shared types + geometry for the qEEG "Case of the Day" feature.
// Framework-agnostic (safe to import from server routes AND client components).

export type QuestionType = "multiple_choice" | "point_to_feature";
export type CaseStatus = "draft" | "pending_review" | "approved" | "published" | "archived";
export type CaseSource = "team" | "ai";
export type Difficulty = "introductory" | "intermediate" | "advanced";
export type ImageLicense =
  | "consortium"      // Tier 1: consortium-owned, de-identified
  | "cc0" | "cc-by" | "cc-by-sa" | "cc-by-nc" | "cc-by-nd"   // Tier 2: openly licensed
  | "public-domain"
  | "ai-original"          // Tier 3: original synthetic image we generated
  | "synthetic-original"   // question bank: rendered from our own image.spec
  | "dataset-derived";     // question bank: from an openly licensed raw dataset

// ---------- question-bank taxonomy (content/qbank/schema/question.schema.json) ----------
export type QbankDomain =
  | "foundations" | "seizure_detection" | "background_terminology"
  | "clinical_prognosis" | "monitoring_practice" | "special_populations_pitfalls";
export type QbankPopulation = "neonate" | "infant" | "child" | "adolescent" | "mixed";
export type QbankSetting = "NICU" | "PICU" | "CICU" | "ECMO" | "ED" | "EMU" | "OR" | "other";
export type QbankBloom = "recall" | "interpretation" | "application" | "analysis";

export const QBANK_DOMAINS: QbankDomain[] = [
  "foundations", "seizure_detection", "background_terminology",
  "clinical_prognosis", "monitoring_practice", "special_populations_pitfalls",
];
export const QBANK_DOMAIN_LABELS: Record<QbankDomain, string> = {
  foundations: "Foundations",
  seizure_detection: "Seizure detection",
  background_terminology: "Background & terminology",
  clinical_prognosis: "Clinical & prognosis",
  monitoring_practice: "Monitoring practice",
  special_populations_pitfalls: "Special populations & pitfalls",
};
export const QBANK_POPULATIONS: QbankPopulation[] = ["neonate", "infant", "child", "adolescent", "mixed"];
export const QBANK_SETTINGS: QbankSetting[] = ["NICU", "PICU", "CICU", "ECMO", "ED", "EMU", "OR", "other"];
export const QBANK_BLOOMS: QbankBloom[] = ["recall", "interpretation", "application", "analysis"];
export const DIFFICULTIES: Difficulty[] = ["introductory", "intermediate", "advanced"];

/** One citation backing an item. Public once the item is published. */
export interface CaseReference {
  id: string;
  pmid: string | null;
  doi: string | null;
  url: string | null;
  citation: string;
  role: "primary" | "supporting";
  verified: boolean;
  verifiedBy: string | null;
  openAccess: string | null;
  memberAuthor: boolean;
  sortOrder: number;
}

/** Answer-region + provenance sidecar written by the eeg-render worker. */
export interface ImageSidecar {
  answer_region?: Region | null;
  width?: number;
  height?: number;
  spec_hash?: string;
  renderer_version?: string;
  [key: string]: unknown;
}

export interface RectRegion { kind: "rect"; x: number; y: number; w: number; h: number }
export interface CircleRegion { kind: "circle"; cx: number; cy: number; r: number }
export interface PolyRegion { kind: "poly"; points: [number, number][] }
export type Region = RectRegion | CircleRegion | PolyRegion;

export interface CaseOption {
  id: string;
  label: string;
  isCorrect: boolean;
  optionExplanation: string | null;
  sortOrder: number;
}

/** Full case (server-side only — includes answers). */
export interface EegCase {
  id: string;
  publishDate: string | null;
  title: string;
  clinicalVignette: string | null;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  imageLicense: ImageLicense | null;
  imageAttribution: string | null;
  imageSourceUrl: string | null;
  questionType: QuestionType;
  questionPrompt: string;
  explanation: string | null;
  teachingPoints: string[];
  correctRegion: Region | null;
  regionTolerance: number | null;
  difficulty: Difficulty;
  tags: string[];
  source: CaseSource;
  aiSourceUrl: string | null;
  aiModel: string | null;
  status: CaseStatus;
  createdAt: string;
  options: CaseOption[];
  // ---- question-bank fields (null on legacy Case-of-the-Day rows) ----
  qbankId: string | null;
  domain: QbankDomain | null;
  population: QbankPopulation | null;
  setting: QbankSetting | null;
  bloom: QbankBloom | null;
  learningObjective: string | null;
  leadIn: string | null;
  imageCaption: string | null;
  keyPoints: string[];
  version: number;
  /** the image.spec the renderer consumes (IMAGE_SPEC.md) */
  spec: unknown | null;
  specHash: string | null;
  /** the whole YAML question, snapshotted for revision diffs */
  content: unknown | null;
  imageSidecar: ImageSidecar | null;
  inBank: boolean;
  createdBy: string | null;
  reviewedBy: string | null;
}

/** What is safe to send to the browser BEFORE the user answers. */
export interface PublicCaseOption { id: string; label: string; sortOrder: number }
export interface PublicCase {
  id: string;
  publishDate: string | null;
  title: string;
  clinicalVignette: string | null;
  imageUrl: string;
  questionType: QuestionType;
  questionPrompt: string;
  difficulty: Difficulty;
  tags: string[];
  status: CaseStatus;
  options: PublicCaseOption[];
  // ---- question-bank additions (safe pre-answer: no answers, no rationales) ----
  qbankId: string | null;
  domain: QbankDomain | null;
  population: QbankPopulation | null;
  setting: QbankSetting | null;
  leadIn: string | null;
  imageCaption: string | null;
  imageLicense: ImageLicense | null;
  imageAttribution: string | null;
  imageSourceUrl: string | null;
  inBank: boolean;
}

/** Aggregate community stats, safe for everyone once they've answered. */
export interface CaseStats {
  total: number;
  correctCount: number;
  optionCounts: Record<string, number>;      // optionId -> count
  points: { x: number; y: number; correct: boolean }[]; // point_to_feature heat-map (downsampled, no identities)
}

/** Payload returned after a user submits an answer. */
export interface RevealResult {
  correct: boolean;
  correctOptionId: string | null;
  optionExplanations: Record<string, { isCorrect: boolean; explanation: string | null }>;
  correctRegion: Region | null;
  explanation: string | null;
  teachingPoints: string[];
  /** question-bank flashcard bullets; absent on legacy cached reveals */
  keyPoints?: string[];
  /** citations behind the explanation; absent on legacy cached reveals */
  references?: CaseReference[];
  yourAnswer: { optionId?: string | null; x?: number | null; y?: number | null };
  stats: CaseStats;
  alreadyAnswered: boolean;
}

// ---------- geometry ----------
export function isPointInRegion(region: Region, x: number, y: number, tol = 0): boolean {
  switch (region.kind) {
    case "rect":
      return x >= region.x - tol && x <= region.x + region.w + tol
          && y >= region.y - tol && y <= region.y + region.h + tol;
    case "circle": {
      const dx = x - region.cx, dy = y - region.cy;
      return Math.sqrt(dx * dx + dy * dy) <= region.r + tol;
    }
    case "poly": {
      const p = region.points;
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i], [xj, yj] = p[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    default:
      return false;
  }
}

// ---------- row mappers (snake_case DB -> camelCase) ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapOption(r: any): CaseOption {
  return {
    id: r.id,
    label: r.label,
    isCorrect: !!r.is_correct,
    optionExplanation: r.option_explanation ?? null,
    sortOrder: r.sort_order ?? 0,
  };
}

export function mapCase(r: any, options: any[] = []): EegCase {
  return {
    id: r.id,
    publishDate: r.publish_date ?? null,
    title: r.title,
    clinicalVignette: r.clinical_vignette ?? null,
    imageUrl: r.image_url ?? "",
    imageWidth: r.image_width ?? null,
    imageHeight: r.image_height ?? null,
    imageLicense: (r.image_license as ImageLicense) ?? null,
    imageAttribution: r.image_attribution ?? null,
    imageSourceUrl: r.image_source_url ?? null,
    questionType: r.question_type,
    questionPrompt: r.question_prompt,
    explanation: r.explanation ?? null,
    teachingPoints: r.teaching_points ?? [],
    correctRegion: (r.correct_region as Region) ?? null,
    regionTolerance: r.region_tolerance ?? null,
    difficulty: r.difficulty ?? "intermediate",
    tags: r.tags ?? [],
    source: r.source ?? "team",
    aiSourceUrl: r.ai_source_url ?? null,
    aiModel: r.ai_model ?? null,
    status: r.status,
    createdAt: r.created_at,
    options: options.map(mapOption).sort((a, b) => a.sortOrder - b.sortOrder),
    qbankId: r.qbank_id ?? null,
    domain: (r.domain as QbankDomain) ?? null,
    population: (r.population as QbankPopulation) ?? null,
    setting: (r.setting as QbankSetting) ?? null,
    bloom: (r.bloom as QbankBloom) ?? null,
    learningObjective: r.learning_objective ?? null,
    leadIn: r.lead_in ?? null,
    imageCaption: r.image_caption ?? null,
    keyPoints: r.key_points ?? [],
    version: r.version ?? 1,
    spec: r.spec ?? null,
    specHash: r.spec_hash ?? null,
    content: r.content ?? null,
    imageSidecar: (r.image_sidecar as ImageSidecar) ?? null,
    inBank: !!r.in_bank,
    createdBy: r.created_by ?? null,
    reviewedBy: r.reviewed_by ?? null,
  };
}

export function mapReference(r: Record<string, unknown>): CaseReference {
  return {
    id: String(r.id),
    pmid: (r.pmid as string) ?? null,
    doi: (r.doi as string) ?? null,
    url: (r.url as string) ?? null,
    citation: (r.citation as string) ?? "",
    role: r.role === "primary" ? "primary" : "supporting",
    verified: !!r.verified,
    verifiedBy: (r.verified_by as string) ?? null,
    openAccess: (r.open_access as string) ?? null,
    memberAuthor: !!r.member_author,
    sortOrder: Number(r.sort_order ?? 0),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Publish gate from docs/CASE_IMAGE_SOURCING_POLICY.md: a case may only be
 * PUBLISHED once it has an image, a license, and — unless the image is
 * consortium-owned or AI-original — a non-empty attribution/credit line.
 * Returns a human-readable reason the case is NOT publishable, or null if it is.
 */
export function caseImagePublishBlock(c: {
  imageUrl: string;
  imageLicense: ImageLicense | null;
  imageAttribution: string | null;
}): string | null {
  if (!c.imageUrl || !c.imageUrl.trim()) return "an image";
  if (!c.imageLicense) return "an image license";
  const exempt = c.imageLicense === "consortium" || c.imageLicense === "ai-original"
    || c.imageLicense === "synthetic-original";
  if (!exempt && !(c.imageAttribution && c.imageAttribution.trim())) {
    return "an attribution/credit line (required for this license)";
  }
  return null;
}

export function toPublicCase(c: EegCase): PublicCase {
  return {
    id: c.id,
    publishDate: c.publishDate,
    title: c.title,
    clinicalVignette: c.clinicalVignette,
    imageUrl: c.imageUrl,
    questionType: c.questionType,
    questionPrompt: c.questionPrompt,
    difficulty: c.difficulty,
    tags: c.tags,
    status: c.status,
    // strip is_correct / explanations / correct_region entirely
    options: c.options
      .map((o) => ({ id: o.id, label: o.label, sortOrder: o.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    qbankId: c.qbankId,
    domain: c.domain,
    population: c.population,
    setting: c.setting,
    leadIn: c.leadIn,
    imageCaption: c.imageCaption,
    imageLicense: c.imageLicense,
    imageAttribution: c.imageAttribution,
    imageSourceUrl: c.imageSourceUrl,
    inBank: c.inBank,
  };
}

/**
 * Attribution line for a case image, per docs/CASE_IMAGE_SOURCING_POLICY.md.
 * Returns null when no credit line is required (our own synthetic renders).
 */
export function imageCreditLine(c: {
  imageLicense: ImageLicense | null;
  imageAttribution: string | null;
  imageSourceUrl: string | null;
}): string | null {
  if (c.imageAttribution && c.imageAttribution.trim()) return c.imageAttribution.trim();
  if (c.imageLicense === "synthetic-original" || c.imageLicense === "ai-original") {
    return "Original synthetic figure rendered by PedQuEST — not a patient recording.";
  }
  if (c.imageLicense === "consortium") return "PedQuEST consortium, de-identified.";
  return null;
}
