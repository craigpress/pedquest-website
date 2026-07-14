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
  | "ai-original";    // Tier 3: original synthetic image we generated

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
  const exempt = c.imageLicense === "consortium" || c.imageLicense === "ai-original";
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
  };
}
