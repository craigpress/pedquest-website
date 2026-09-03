// Server-only data access for the qEEG question bank. Uses the SERVICE-ROLE
// client, so answers, rationales and unpublished drafts never depend on
// client-side RLS. NEVER import this from a "use client" module.
import { createServerClient } from "@/lib/supabase";
import {
  mapCase, mapReference, toPublicCase,
  type CaseReference, type Difficulty, type EegCase, type PublicCase,
  type QbankDomain, type QbankPopulation, type QbankSetting,
} from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Learner-facing reads (published bank items only)
// ---------------------------------------------------------------------------

export interface BankFilters {
  domain?: QbankDomain | null;
  difficulty?: Difficulty | null;
  population?: QbankPopulation | null;
  setting?: QbankSetting | null;
  limit?: number;
}

/** Lightweight card for the browse grid — no answers, no explanation. */
export interface BankSummary {
  id: string;
  qbankId: string | null;
  title: string;
  leadIn: string | null;
  domain: QbankDomain | null;
  population: QbankPopulation | null;
  setting: QbankSetting | null;
  difficulty: Difficulty;
  questionType: string;
  imageUrl: string;
  tags: string[];
  publishDate: string | null;
}

const SUMMARY_COLUMNS =
  "id,qbank_id,title,lead_in,domain,population,setting,difficulty,question_type,image_url,tags,publish_date";

function mapSummary(r: any): BankSummary {
  return {
    id: r.id,
    qbankId: r.qbank_id ?? null,
    title: r.title,
    leadIn: r.lead_in ?? null,
    domain: (r.domain as QbankDomain) ?? null,
    population: (r.population as QbankPopulation) ?? null,
    setting: (r.setting as QbankSetting) ?? null,
    difficulty: (r.difficulty as Difficulty) ?? "intermediate",
    questionType: r.question_type,
    imageUrl: r.image_url ?? "",
    tags: r.tags ?? [],
    publishDate: r.publish_date ?? null,
  };
}

/** Every published item that is part of the bank, newest first. */
export async function listBankItems(filters: BankFilters = {}): Promise<BankSummary[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  let q = supabase
    .from("eeg_cases")
    .select(SUMMARY_COLUMNS)
    .eq("in_bank", true)
    .eq("status", "published");
  if (filters.domain) q = q.eq("domain", filters.domain);
  if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
  if (filters.population) q = q.eq("population", filters.population);
  if (filters.setting) q = q.eq("setting", filters.setting);
  const { data, error } = await q
    .order("publish_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(Math.min(filters.limit ?? 300, 500));
  if (error || !data) return [];
  return data.map(mapSummary);
}

/** Counts per facet, for the landing page and the filter chips. */
export interface BankFacets {
  total: number;
  byDomain: Record<string, number>;
  byDifficulty: Record<string, number>;
  byPopulation: Record<string, number>;
  bySetting: Record<string, number>;
}

export async function getBankFacets(): Promise<BankFacets> {
  const empty: BankFacets = { total: 0, byDomain: {}, byDifficulty: {}, byPopulation: {}, bySetting: {} };
  const supabase = createServerClient();
  if (!supabase) return empty;
  const { data, error } = await supabase
    .from("eeg_cases")
    .select("domain,difficulty,population,setting")
    .eq("in_bank", true)
    .eq("status", "published");
  if (error || !data) return empty;
  const facets: BankFacets = { total: data.length, byDomain: {}, byDifficulty: {}, byPopulation: {}, bySetting: {} };
  for (const r of data as any[]) {
    if (r.domain) facets.byDomain[r.domain] = (facets.byDomain[r.domain] || 0) + 1;
    if (r.difficulty) facets.byDifficulty[r.difficulty] = (facets.byDifficulty[r.difficulty] || 0) + 1;
    if (r.population) facets.byPopulation[r.population] = (facets.byPopulation[r.population] || 0) + 1;
    if (r.setting) facets.bySetting[r.setting] = (facets.bySetting[r.setting] || 0) + 1;
  }
  return facets;
}

/** Answer-stripped item for the learner page. Published bank items only. */
export async function getPublicBankItem(id: string): Promise<PublicCase | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data: rows } = await supabase.from("eeg_cases").select("*").eq("id", id).limit(1);
  const row = rows?.[0];
  if (!row || row.status !== "published" || !row.in_bank) return null;
  const { data: opts } = await supabase
    .from("eeg_case_options").select("*").eq("case_id", row.id).order("sort_order");
  return toPublicCase(mapCase(row, opts ?? []));
}

/**
 * Practice mode: a random published bank item this member has not answered.
 * Filters narrow the pool the same way the browse page does.
 */
export async function pickUnansweredItem(
  userId: string,
  filters: BankFilters = {},
): Promise<BankSummary | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const pool = await listBankItems({ ...filters, limit: 500 });
  if (pool.length === 0) return null;
  const { data: answered } = await supabase
    .from("eeg_responses").select("case_id").eq("user_id", userId);
  const seen = new Set((answered ?? []).map((r: any) => r.case_id));
  const remaining = pool.filter((i) => !seen.has(i.id));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

/** Per-domain progress for the signed-in member. */
export interface DomainProgress {
  domain: string;
  total: number;
  answered: number;
  correct: number;
}
export interface BankProgress {
  total: number;
  answered: number;
  correct: number;
  byDomain: DomainProgress[];
}

export async function getBankProgress(userId: string): Promise<BankProgress> {
  const empty: BankProgress = { total: 0, answered: 0, correct: 0, byDomain: [] };
  const supabase = createServerClient();
  if (!supabase) return empty;

  const { data: items } = await supabase
    .from("eeg_cases")
    .select("id,domain")
    .eq("in_bank", true)
    .eq("status", "published");
  if (!items || items.length === 0) return empty;

  const domainById = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const r of items as any[]) {
    const d = r.domain ?? "unclassified";
    domainById.set(r.id, d);
    totals.set(d, (totals.get(d) ?? 0) + 1);
  }

  const { data: responses } = await supabase
    .from("eeg_responses")
    .select("case_id,is_correct")
    .eq("user_id", userId);

  const answered = new Map<string, number>();
  const correct = new Map<string, number>();
  let answeredTotal = 0;
  let correctTotal = 0;
  for (const r of (responses ?? []) as any[]) {
    const d = domainById.get(r.case_id);
    if (!d) continue; // a response to a non-bank Case of the Day
    answered.set(d, (answered.get(d) ?? 0) + 1);
    answeredTotal++;
    if (r.is_correct) {
      correct.set(d, (correct.get(d) ?? 0) + 1);
      correctTotal++;
    }
  }

  return {
    total: items.length,
    answered: answeredTotal,
    correct: correctTotal,
    byDomain: [...totals.entries()]
      .map(([domain, total]) => ({
        domain,
        total,
        answered: answered.get(domain) ?? 0,
        correct: correct.get(domain) ?? 0,
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain)),
  };
}

// ---------------------------------------------------------------------------
// Editor-facing reads (all statuses; callers must have gone through requireRole)
// ---------------------------------------------------------------------------

export interface EditorQueueItem extends BankSummary {
  status: string;
  source: string;
  version: number;
  imageLicense: string | null;
  verifiedRefs: number;
  totalRefs: number;
  responseCount: number;
  createdAt: string;
  updatedAt: string | null;
  reviewedBy: string | null;
  createdBy: string | null;
}

export interface EditorQueueFilters extends BankFilters {
  status?: string | null;
  source?: string | null;
  inBankOnly?: boolean;
}

export async function listEditorQueue(filters: EditorQueueFilters = {}): Promise<EditorQueueItem[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  let q = supabase
    .from("eeg_cases")
    .select(`${SUMMARY_COLUMNS},status,source,version,image_license,created_at,updated_at,reviewed_by,created_by`);
  if (filters.inBankOnly) q = q.eq("in_bank", true);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.source) q = q.eq("source", filters.source);
  if (filters.domain) q = q.eq("domain", filters.domain);
  if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
  if (filters.population) q = q.eq("population", filters.population);
  if (filters.setting) q = q.eq("setting", filters.setting);

  const { data, error } = await q
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(Math.min(filters.limit ?? 300, 500));
  if (error || !data) return [];

  const ids = data.map((r: any) => r.id);
  const refCounts: Record<string, { total: number; verified: number }> = {};
  const responseCounts: Record<string, number> = {};
  if (ids.length) {
    const { data: refs } = await supabase
      .from("eeg_case_references").select("case_id,verified").in("case_id", ids);
    for (const r of (refs ?? []) as any[]) {
      const bucket = (refCounts[r.case_id] ||= { total: 0, verified: 0 });
      bucket.total++;
      if (r.verified) bucket.verified++;
    }
    const { data: resp } = await supabase
      .from("eeg_responses").select("case_id").in("case_id", ids);
    for (const r of (resp ?? []) as any[]) {
      responseCounts[r.case_id] = (responseCounts[r.case_id] || 0) + 1;
    }
  }

  return data.map((r: any) => ({
    ...mapSummary(r),
    status: r.status,
    source: r.source,
    version: r.version ?? 1,
    imageLicense: r.image_license ?? null,
    verifiedRefs: refCounts[r.id]?.verified ?? 0,
    totalRefs: refCounts[r.id]?.total ?? 0,
    responseCount: responseCounts[r.id] ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    reviewedBy: r.reviewed_by ?? null,
    createdBy: r.created_by ?? null,
  }));
}

/** Counts by status across the whole pipeline, for the queue header. */
export async function getQueueCounts(): Promise<Record<string, number>> {
  const supabase = createServerClient();
  if (!supabase) return {};
  const { data, error } = await supabase.from("eeg_cases").select("status,in_bank");
  if (error || !data) return {};
  const counts: Record<string, number> = { all: 0, bank: 0 };
  for (const r of data as any[]) {
    counts.all++;
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.in_bank) counts.bank++;
  }
  return counts;
}

export interface CaseRevision {
  id: string;
  version: number;
  content: unknown;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}
export interface CaseReview {
  id: string;
  reviewer: string | null;
  reviewerEmail: string | null;
  decision: string;
  notes: string | null;
  createdAt: string;
}
export interface EditorItem {
  case: EegCase;
  references: CaseReference[];
  revisions: CaseRevision[];
  reviews: CaseReview[];
  renderJob: { id: string; status: string; imageUrl: string | null; error: string | null } | null;
}

/** Everything the item page needs, in one round trip set. */
export async function getEditorItem(id: string): Promise<EditorItem | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data: rows } = await supabase.from("eeg_cases").select("*").eq("id", id).limit(1);
  const row = rows?.[0];
  if (!row) return null;

  const [{ data: opts }, { data: refs }, { data: revs }, { data: reviews }, { data: jobs }] = await Promise.all([
    supabase.from("eeg_case_options").select("*").eq("case_id", id).order("sort_order"),
    supabase.from("eeg_case_references").select("*").eq("case_id", id).order("sort_order"),
    supabase.from("eeg_case_revisions").select("*").eq("case_id", id).order("version", { ascending: false }).limit(30),
    supabase.from("eeg_case_reviews").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.from("eeg_case_render_jobs").select("id,status,image_url,error").eq("case_id", id)
      .order("created_at", { ascending: false }).limit(1),
  ]);

  return {
    case: mapCase(row, opts ?? []),
    references: (refs ?? []).map(mapReference),
    revisions: ((revs ?? []) as any[]).map((r) => ({
      id: r.id, version: r.version, content: r.content ?? null,
      changedBy: r.changed_by ?? null, changeNote: r.change_note ?? null, createdAt: r.created_at,
    })),
    reviews: ((reviews ?? []) as any[]).map((r) => ({
      id: r.id, reviewer: r.reviewer ?? null, reviewerEmail: r.reviewer_email ?? null,
      decision: r.decision, notes: r.notes ?? null, createdAt: r.created_at,
    })),
    renderJob: jobs?.[0]
      ? { id: jobs[0].id, status: jobs[0].status, imageUrl: jobs[0].image_url ?? null, error: jobs[0].error ?? null }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
