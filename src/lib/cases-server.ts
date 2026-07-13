// Server-only data access for qEEG cases. Uses the SERVICE-ROLE client so the
// correct answers / regions / responses never depend on client-side RLS.
// NEVER import this from a "use client" module.
import { createServerClient } from "@/lib/supabase";
import { mapCase, toPublicCase, type EegCase, type PublicCase, type CaseStats } from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function loadCaseRow(match: (q: any) => any): Promise<EegCase | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data: rows, error } = await match(supabase.from("eeg_cases").select("*"));
  if (error || !rows || rows.length === 0) return null;
  const row = rows[0];
  const { data: opts } = await supabase
    .from("eeg_case_options").select("*").eq("case_id", row.id).order("sort_order");
  return mapCase(row, opts ?? []);
}

/** The current "case of the day": newest published case whose date has arrived. */
export async function getTodaysCase(): Promise<EegCase | null> {
  const today = new Date().toISOString().slice(0, 10);
  return loadCaseRow((q) =>
    q.eq("status", "published").lte("publish_date", today).order("publish_date", { ascending: false }).limit(1));
}

export async function getCaseById(id: string): Promise<EegCase | null> {
  return loadCaseRow((q) => q.eq("id", id).limit(1));
}

/** Public (answer-stripped) variants for rendering pages. */
export async function getTodaysPublicCase(): Promise<PublicCase | null> {
  const c = await getTodaysCase();
  return c ? toPublicCase(c) : null;
}
export async function getPublicCaseById(id: string): Promise<PublicCase | null> {
  const c = await getCaseById(id);
  if (!c) return null;
  // only expose cases that have been published/archived to the public page
  if (c.status !== "published" && c.status !== "archived") return null;
  return toPublicCase(c);
}

/** Archive list (published + archived), lightweight. */
export interface ArchiveItem {
  id: string; title: string; publishDate: string | null; questionType: string;
  difficulty: string; tags: string[]; imageUrl: string; status: string;
}
export async function getArchive(limit = 60): Promise<ArchiveItem[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("eeg_cases")
    .select("id,title,publish_date,question_type,difficulty,tags,image_url,status")
    .in("status", ["published", "archived"])
    .lte("publish_date", today)
    .order("publish_date", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r: any) => ({
    id: r.id, title: r.title, publishDate: r.publish_date ?? null,
    questionType: r.question_type, difficulty: r.difficulty ?? "intermediate",
    tags: r.tags ?? [], imageUrl: r.image_url ?? "", status: r.status,
  }));
}

/** Aggregate community stats for a case (no identities). */
export async function getCaseStats(caseId: string): Promise<CaseStats> {
  const empty: CaseStats = { total: 0, correctCount: 0, optionCounts: {}, points: [] };
  const supabase = createServerClient();
  if (!supabase) return empty;
  const { data, error } = await supabase
    .from("eeg_responses")
    .select("selected_option_id,pointed_x,pointed_y,is_correct")
    .eq("case_id", caseId);
  if (error || !data) return empty;
  const stats: CaseStats = { total: data.length, correctCount: 0, optionCounts: {}, points: [] };
  for (const r of data as any[]) {
    if (r.is_correct) stats.correctCount++;
    if (r.selected_option_id) stats.optionCounts[r.selected_option_id] = (stats.optionCounts[r.selected_option_id] || 0) + 1;
    if (r.pointed_x != null && r.pointed_y != null)
      stats.points.push({ x: Number(r.pointed_x), y: Number(r.pointed_y), correct: !!r.is_correct });
  }
  // cap heat-map payload
  if (stats.points.length > 500) {
    const step = Math.ceil(stats.points.length / 500);
    stats.points = stats.points.filter((_, i) => i % step === 0);
  }
  return stats;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
