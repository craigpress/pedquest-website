// Revise an existing AI-generated item from an editor's review feedback, then
// re-run a deterministic critic + PMID verification and enqueue a fresh render.
//
// This closes the loop the editor console opens: "request changes" on an
// AI-generated item queues a revision job (mode = 'revision' on
// eeg_case_generation_jobs); this module drains it — inline from the
// /admin/qbank "Revise with AI" action, and in bulk from the weekly cron so it
// happens even if no one presses the button.
//
// A revision is an EDIT, not a redraft: the model receives the full current
// item and is told to keep everything the feedback does not touch. It also
// re-receives the abstracts that grounded the ORIGINAL draft (stored on the
// generation job's `retrieval`), so when those exist the numbers-sourced and
// references checks run exactly as for a fresh draft. For a human-authored
// item there is no stored corpus; those two checks are then skipped and the
// human editor is the backstop. Structure, one-best-answer, terminology,
// copyright and PMID existence are always enforced.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chat, extractJson } from "./provider";
import { buildSystemPrompt, loadPromptContext } from "./draft";
import {
  checkCopyrightAndPrivacy, checkNumbersSourced, checkOneBestAnswer, checkReferences,
  checkStructure, checkTerminology, type CriticFinding, type CriticReport,
} from "./critic";
import { formatEvidence, type RetrievedArticle } from "./retrieve";
import { verifyPmids } from "./verify";
import { questionToRows, type QbankQuestion } from "./question";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ReviseResult {
  question: QbankQuestion;
  provider: string;
  model: string;
}

function buildReviseUserPrompt(current: QbankQuestion, feedback: string, articles: RetrievedArticle[]): string {
  return [
    "Revise the following PedQuEST question-bank item to address the editor's",
    "feedback. Keep everything the feedback does not ask you to change. This is an",
    "EDIT of the item below, not a new item — reuse its vignette, options,",
    "explanation and references wherever the feedback does not require a change.",
    "Preserve the id, and preserve the references and their PMIDs unless the",
    "feedback requires otherwise; do NOT invent new numbers or new PMIDs. If the",
    "feedback is about the image, change image.spec — the picture is rendered",
    "deterministically from it — and keep image_caption and any point_to_feature",
    "target consistent with the new spec.",
    ...(articles.length
      ? [
          "",
          "Every number you keep or add in the stem or explanation must still appear",
          "in the ORIGINAL EVIDENCE below (the same abstracts that grounded the first",
          "draft). Do not introduce a statistic that is not in it.",
        ]
      : []),
    "",
    "Return ONE JSON object and nothing else: the full revised item, valid against",
    'the schema, with metadata.source_method still "ai-generated-pipeline".',
    "",
    "=== EDITOR FEEDBACK ===",
    feedback || "(no written feedback — improve clarity and ensure one best answer)",
    ...(articles.length ? ["", "=== ORIGINAL EVIDENCE (reuse; do not go beyond it) ===", formatEvidence(articles)] : []),
    "",
    "=== CURRENT ITEM (JSON) ===",
    JSON.stringify(current, null, 2),
    "",
    "Your response must begin with { and end with }.",
  ].join("\n");
}

export async function reviseQuestion(input: {
  current: QbankQuestion;
  feedback: string;
  /** the abstracts that grounded the original draft, if available */
  articles?: RetrievedArticle[];
  timeoutMs?: number;
}): Promise<ReviseResult> {
  const ctx = await loadPromptContext();
  const system = buildSystemPrompt(ctx);
  const user = buildReviseUserPrompt(input.current, input.feedback, input.articles ?? []);
  const result = await chat({ system, user, timeoutMs: input.timeoutMs });
  if (/"mock"\s*:\s*true/.test(result.text)) {
    throw new Error(
      "No LLM provider is configured — set OPENWEBUI_BASE_URL/API_KEY/MODEL or ANTHROPIC_API_KEY.",
    );
  }
  const raw = extractJson(result.text);
  if (typeof raw !== "object" || raw === null) throw new Error("The revision was not a JSON object.");
  const q = raw as QbankQuestion;
  // Lineage is ours; the model must not move it.
  q.id = input.current.id;
  q.status = "draft";
  if (!q.metadata) throw new Error("The revised item has no metadata block.");
  q.metadata.source_method = "ai-generated-pipeline";
  q.metadata.model = result.model;
  return { question: q, provider: result.provider, model: result.model };
}

/** Deterministic critic for a revision. When the original evidence corpus is
 *  available (it is stored for AI items) the numbers-sourced and references
 *  checks run against it, exactly as for a fresh draft; otherwise they are
 *  omitted and a human editor is the backstop (see file header). */
export async function critiqueRevision(q: QbankQuestion, articles: RetrievedArticle[] = []): Promise<CriticReport> {
  const findings: CriticFinding[] = [
    ...checkStructure(q),
    ...checkOneBestAnswer(q),
    ...checkTerminology(q),
    ...checkCopyrightAndPrivacy(q),
    ...(articles.length ? checkNumbersSourced(q, articles) : []),
    ...(articles.length ? checkReferences(q, articles) : []),
  ];
  const pmids = (q.references ?? []).map((r) => r.pmid).filter((p): p is string => !!p);
  if (pmids.length) {
    const verified = await verifyPmids(pmids);
    for (const ref of q.references ?? []) {
      if (!ref.pmid) continue;
      const rec = verified.get(String(ref.pmid));
      ref.verified = !!rec?.exists;
      ref.verified_by = rec?.exists ? "qbank-revision (PubMed esummary)" : undefined;
      if (!rec?.exists) {
        findings.push({ check: "references", severity: "error", detail: `PMID ${ref.pmid} did not verify` });
      }
    }
  } else {
    findings.push({ check: "references", severity: "error", detail: "no PMID references remain after revision" });
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  return {
    pass: errors === 0,
    findings,
    score: Math.max(0, Math.round(((4 - Math.min(errors, 4)) / 4) * 100) / 100),
  };
}

/** Map a revised question onto the existing case row and replace its children.
 *  Content-bearing UPDATE fires the DB version_bump trigger, which snapshots a
 *  revision and increments version. image_url is left alone — the render job
 *  updates it once the new picture is produced. */
async function writeRevisedCase(supabase: SupabaseClient, caseId: string, q: QbankQuestion): Promise<void> {
  const { case: c, options, references } = questionToRows(q, null);
  const { error: upErr } = await supabase.from("eeg_cases").update({
    title: c.title, domain: c.domain, population: c.population, setting: c.setting,
    bloom: c.bloom, difficulty: c.difficulty, learning_objective: c.learning_objective,
    clinical_vignette: c.clinical_vignette, image_caption: c.image_caption, lead_in: c.lead_in,
    question_type: c.question_type, question_prompt: c.question_prompt, explanation: c.explanation,
    key_points: c.key_points, teaching_points: c.teaching_points, tags: c.tags,
    correct_region: c.correct_region, region_tolerance: c.region_tolerance,
    image_license: c.image_license, image_attribution: c.image_attribution,
    spec: c.spec, spec_hash: c.spec_hash, content: c.content,
    status: "pending_review",
  }).eq("id", caseId);
  if (upErr) throw new Error(`could not update the case: ${upErr.message}`);

  await supabase.from("eeg_case_options").delete().eq("case_id", caseId);
  if (options.length) {
    const { error } = await supabase.from("eeg_case_options")
      .insert(options.map((o) => ({ ...o, case_id: caseId })));
    if (error) throw new Error(`could not write options: ${error.message}`);
  }
  await supabase.from("eeg_case_references").delete().eq("case_id", caseId);
  if (references.length) {
    const { error } = await supabase.from("eeg_case_references")
      .insert(references.map((r) => ({ ...r, case_id: caseId })));
    if (error) throw new Error(`could not write references: ${error.message}`);
  }
}

export interface RevisionOutcome {
  jobId: string;
  caseId: string;
  ok: boolean;
  renderJobId?: string | null;
  critic?: CriticReport;
  error?: string;
}

/** Run one queued revision job end to end: revise → critic → write → render. */
export async function processRevisionJob(
  supabase: SupabaseClient,
  jobId: string,
  opts: { timeoutMs?: number } = {},
): Promise<RevisionOutcome> {
  const { data: job } = await supabase
    .from("eeg_case_generation_jobs")
    .select("id,case_id,feedback,mode")
    .eq("id", jobId).maybeSingle();
  if (!job || (job as any).mode !== "revision" || !(job as any).case_id) {
    return { jobId, caseId: (job as any)?.case_id ?? "", ok: false, error: "not a revision job" };
  }
  const caseId = (job as any).case_id as string;
  await supabase.from("eeg_case_generation_jobs").update({ status: "running" }).eq("id", jobId);

  const failJob = async (msg: string, extra: Record<string, unknown> = {}): Promise<RevisionOutcome> => {
    await supabase.from("eeg_case_generation_jobs")
      .update({ status: "failed", error: msg.slice(0, 2000), ...extra }).eq("id", jobId);
    return { jobId, caseId, ok: false, error: msg };
  };

  const { data: caseRow } = await supabase
    .from("eeg_cases").select("id,content").eq("id", caseId).maybeSingle();
  const content = (caseRow as any)?.content as QbankQuestion | undefined;
  if (!content || typeof content !== "object") {
    return failJob("this item has no stored content snapshot to revise — import or generate it first, or edit the spec by hand and re-render");
  }

  // Reuse the abstracts that grounded the ORIGINAL draft (stored on the
  // generation job) so a revision stays sourced to the same evidence rather
  // than being redrafted free-hand. Absent for human-authored items, which is
  // fine — the human editor is the backstop.
  const { data: priorJob } = await supabase
    .from("eeg_case_generation_jobs")
    .select("retrieval")
    .eq("case_id", caseId).not("retrieval", "is", null)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const articles = (((priorJob as any)?.retrieval?.articles ?? []) as RetrievedArticle[]);

  let revised: ReviseResult;
  try {
    revised = await reviseQuestion({ current: content, feedback: (job as any).feedback ?? "", articles, timeoutMs: opts.timeoutMs });
  } catch (e) {
    return failJob(`the revision step failed: ${(e as Error).message}`);
  }

  const critic = await critiqueRevision(revised.question, articles);
  if (!critic.pass) {
    const reasons = critic.findings.filter((f) => f.severity === "error").map((f) => `${f.check}: ${f.detail}`).join("; ");
    return failJob(`the critic rejected the revision: ${reasons}`, { draft: revised.question, critic_report: critic });
  }

  try {
    await writeRevisedCase(supabase, caseId, revised.question);
  } catch (e) {
    return failJob((e as Error).message, { draft: revised.question, critic_report: critic });
  }

  const { data: renderRow } = await supabase
    .from("eeg_case_render_jobs")
    .insert({ case_id: caseId, spec: revised.question.image.spec, status: "pending" })
    .select("id").single();

  await supabase.from("eeg_case_generation_jobs")
    .update({ status: "drafted", draft: revised.question, critic_report: critic, model: revised.model })
    .eq("id", jobId);

  return { jobId, caseId, ok: true, renderJobId: (renderRow as any)?.id ?? null, critic };
}

/** Drain queued revision jobs (called by the weekly cron). Also resets jobs
 *  stuck in `running` for over 10 minutes — a Vercel function timeout can leave
 *  an inline revision half-done. */
export async function drainRevisionJobs(
  supabase: SupabaseClient,
  opts: { limit?: number; timeoutMs?: number; budgetMs?: number } = {},
): Promise<RevisionOutcome[]> {
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  await supabase
    .from("eeg_case_generation_jobs")
    .update({ status: "pending" })
    .eq("mode", "revision").eq("status", "running").lt("updated_at", staleBefore);

  const { data: jobs } = await supabase
    .from("eeg_case_generation_jobs")
    .select("id")
    .eq("mode", "revision").eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 5);

  const started = Date.now();
  const out: RevisionOutcome[] = [];
  for (const j of (jobs ?? []) as any[]) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
    out.push(await processRevisionJob(supabase, j.id, { timeoutMs: opts.timeoutMs }));
  }
  return out;
}

/** Create a revision job for a case from feedback (used by the review action
 *  and the manual "Revise with AI" action). */
export async function queueRevisionJob(
  supabase: SupabaseClient,
  input: { caseId: string; feedback: string; model?: string; title?: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("eeg_case_generation_jobs")
    .insert({
      mode: "revision",
      case_id: input.caseId,
      feedback: input.feedback?.slice(0, 4000) || null,
      topic: `revision: ${(input.title ?? input.caseId).slice(0, 120)}`,
      model: input.model ?? null,
      status: "pending",
    })
    .select("id").single();
  if (error) return null;
  return (data as any).id as string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
