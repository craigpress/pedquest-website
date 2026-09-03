// Orchestrator for the automated generation pipeline:
//
//   blueprint gap -> PubMed retrieval -> draft -> critic -> PMID verification
//   -> case row (pending_review | draft) -> render job -> editor notification
//
// The Supabase client is injected rather than imported so this module works
// both inside the cron route (service-role client) and in
// `npm run qbank:generate -- --dry-run`, which passes null and writes nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { coverageGaps, loadBlueprint, planTopics } from "./blueprint";
import { critique, type CriticReport } from "./critic";
import { describeProvider, draftQuestion, PROMPT_VERSION } from "./draft";
import { citationFor, retrieveEvidence, type RetrievedArticle } from "./retrieve";
import { questionToRows, type QbankQuestion } from "./question";
import { verifyPmids } from "./verify";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The pipeline owns the `G` writer slot; humans use A and B (BLUEPRINT.md). */
const PIPELINE_WRITER = "G";

export interface GenerateOptions {
  /** how many drafts to attempt */
  count?: number;
  /** stop starting new drafts once this much wall clock has passed */
  budgetMs?: number;
  /** per-LLM-call timeout */
  timeoutMs?: number;
  /** write nothing; used by the --dry-run script */
  dryRun?: boolean;
  /** force a single (domain, topic) instead of using the blueprint gap */
  domain?: string;
  topic?: string;
  /** authenticated editor who requested the draft */
  requestedBy?: string;
}

export interface GenerateItemResult {
  id: string;
  domain: string;
  topic: string;
  /** the drafted title, so a caller can name the item without the full draft */
  title?: string;
  jobId: string | null;
  renderJobId: string | null;
  caseId: string | null;
  status: "drafted" | "failed";
  caseStatus?: "pending_review" | "draft";
  pmids: string[];
  critic?: CriticReport;
  error?: string;
  /** only populated on a dry run, so the caller can print the draft */
  question?: QbankQuestion;
}

export interface GenerateSummary {
  provider: string;
  model: string;
  promptVersion: string;
  planned: { domain: string; topic: string }[];
  results: GenerateItemResult[];
  blueprintMissing: boolean;
  notes: string[];
}

// ---------------------------------------------------------------------------
// helpers that need the DB
// ---------------------------------------------------------------------------

async function domainCounts(supabase: SupabaseClient | null): Promise<Record<string, number>> {
  if (!supabase) return {};
  const { data } = await supabase
    .from("eeg_cases")
    .select("domain,status")
    .eq("in_bank", true)
    .not("status", "eq", "archived");
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as any[]) {
    if (r.domain) counts[r.domain] = (counts[r.domain] || 0) + 1;
  }
  return counts;
}

/** Learning objectives already covered, so a repeat run proposes new ones. */
async function existingTopics(supabase: SupabaseClient | null): Promise<string[]> {
  if (!supabase) return [];
  const [{ data: cases }, { data: jobs }] = await Promise.all([
    supabase.from("eeg_cases").select("learning_objective").eq("in_bank", true),
    supabase.from("eeg_case_generation_jobs").select("topic").in("status", ["pending", "running", "drafted"]),
  ]);
  return [
    ...((cases ?? []) as any[]).map((r) => r.learning_objective).filter(Boolean),
    ...((jobs ?? []) as any[]).map((r) => r.topic).filter(Boolean),
  ];
}

/** Stems already in the bank, for the critic's duplicate check. */
async function existingStems(supabase: SupabaseClient | null): Promise<{ id: string; stem: string }[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("eeg_cases")
    .select("qbank_id,clinical_vignette,lead_in")
    .eq("in_bank", true);
  return ((data ?? []) as any[])
    .filter((r) => r.qbank_id)
    .map((r) => ({ id: r.qbank_id, stem: `${r.clinical_vignette ?? ""} ${r.lead_in ?? ""}` }));
}

/** Next free PQ-G-NNN. */
async function nextPipelineId(supabase: SupabaseClient | null): Promise<string> {
  if (!supabase) return `PQ-${PIPELINE_WRITER}-001`;
  const { data } = await supabase
    .from("eeg_cases")
    .select("qbank_id")
    .like("qbank_id", `PQ-${PIPELINE_WRITER}-%`);
  let max = 0;
  for (const r of (data ?? []) as any[]) {
    const n = parseInt(String(r.qbank_id).slice(-3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PQ-${PIPELINE_WRITER}-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------

/**
 * Generate up to `count` drafts. Every draft gets a generation-job row so a
 * failure is inspectable afterwards rather than lost in a log.
 */
export async function generateDrafts(
  supabase: SupabaseClient | null,
  opts: GenerateOptions = {},
): Promise<GenerateSummary> {
  const count = Math.max(1, Math.min(opts.count ?? 3, 10));
  const budgetMs = opts.budgetMs ?? 50_000;
  const startedAt = Date.now();
  const { provider, model } = describeProvider();
  const notes: string[] = [];

  // ---- plan ----
  const blueprint = await loadBlueprint();
  if (blueprint.length === 0) {
    notes.push("content/qbank/BLUEPRINT.md was not readable — falling back to the requested topic only.");
  }
  let planned: { domain: string; topic: string }[];
  if (opts.domain && opts.topic) {
    planned = [{ domain: opts.domain, topic: opts.topic }];
  } else {
    const gaps = coverageGaps(blueprint, await domainCounts(supabase));
    planned = planTopics(gaps, count, await existingTopics(supabase));
    if (planned.length === 0) {
      notes.push("No coverage gap left in the blueprint (or no scope text to draw a topic from).");
    }
  }

  const stems = await existingStems(supabase);
  const results: GenerateItemResult[] = [];

  for (const plan of planned) {
    if (Date.now() - startedAt > budgetMs) {
      notes.push(`Stopped after ${results.length} draft(s): the ${budgetMs} ms budget ran out.`);
      break;
    }

    const id = await nextPipelineId(supabase);
    let jobId: string | null = null;

    if (supabase && !opts.dryRun) {
      const { data, error } = await supabase
        .from("eeg_case_generation_jobs")
        .insert({
          domain: plan.domain, topic: plan.topic, model,
          prompt_version: PROMPT_VERSION, status: "running",
        })
        .select("id")
        .single();
      if (error) {
        results.push({
          id, domain: plan.domain, topic: plan.topic, jobId: null, caseId: null,
          renderJobId: null,
          status: "failed", pmids: [], error: `could not create a generation job: ${error.message}`,
        });
        continue;
      }
      jobId = data.id as string;
    }

    const fail = async (message: string, extra: Record<string, unknown> = {}) => {
      if (supabase && jobId && !opts.dryRun) {
        await supabase.from("eeg_case_generation_jobs")
          .update({ status: "failed", error: message, ...extra })
          .eq("id", jobId);
      }
      results.push({
        id, domain: plan.domain, topic: plan.topic, jobId, caseId: null,
        renderJobId: null,
        status: "failed", pmids: [], error: message,
      });
    };

    // ---- retrieve ----
    const retrieval = await retrieveEvidence(plan.domain, plan.topic);
    if (retrieval.articles.length === 0) {
      await fail(`no usable evidence: ${retrieval.error ?? "no abstracts"}`, { retrieval });
      continue;
    }
    if (supabase && jobId && !opts.dryRun) {
      await supabase.from("eeg_case_generation_jobs").update({ retrieval }).eq("id", jobId);
    }

    // ---- draft ----
    let question: QbankQuestion;
    try {
      const drafted = await draftQuestion({
        id, domain: plan.domain, topic: plan.topic,
        articles: retrieval.articles, timeoutMs: opts.timeoutMs,
      });
      question = drafted.question;
    } catch (e) {
      await fail(`draft failed: ${(e as Error).message}`);
      continue;
    }

    // ---- critic ----
    const critic = await critique({
      question,
      articles: retrieval.articles,
      existingStems: stems,
      runCoverTest: true,
      timeoutMs: opts.timeoutMs,
    });

    // ---- verify the PMIDs the draft cited ----
    const pmids = (question.references ?? []).map((r) => r.pmid).filter((p): p is string => !!p);
    const verified = await verifyPmids(pmids);
    for (const ref of question.references ?? []) {
      if (!ref.pmid) continue;
      const record = verified.get(String(ref.pmid));
      ref.verified = !!record?.exists;
      ref.verified_by = record?.exists ? "qbank-pipeline (PubMed esummary)" : undefined;
      if (!record?.exists) {
        critic.findings.push({
          check: "pmids_verified", severity: "error",
          detail: `PMID ${ref.pmid} did not verify: ${record?.error ?? "unknown"}`,
        });
        critic.pass = false;
      }
      // Prefer the retrieved article's own citation string over the model's.
      const source = retrieval.articles.find((a: RetrievedArticle) => a.pmid === String(ref.pmid));
      if (source) ref.citation = citationFor(source);
    }
    if (question.metadata?.checklist) {
      question.metadata.checklist.pmids_verified = (question.references ?? []).every((r) => r.verified);
      question.metadata.checklist.numbers_sourced =
        !critic.findings.some((f) => f.check === "numbers_sourced" && f.severity === "error");
      question.metadata.checklist.one_best_answer =
        !critic.findings.some((f) => f.check === "one_best_answer" && f.severity === "error");
      question.metadata.checklist.no_copyright_reuse =
        !critic.findings.some((f) => f.check === "no_copyright_reuse" && f.severity === "error");
    }

    if (!critic.pass) {
      const reasons = critic.findings.filter((f) => f.severity === "error").map((f) => `${f.check}: ${f.detail}`);
      if (supabase && jobId && !opts.dryRun) {
        await supabase.from("eeg_case_generation_jobs")
          .update({ status: "failed", error: reasons.join(" | ").slice(0, 2000), draft: question, critic_report: critic })
          .eq("id", jobId);
      }
      results.push({
        id, domain: plan.domain, topic: plan.topic, jobId, caseId: null,
        renderJobId: null,
        status: "failed", pmids, critic,
        error: `critic rejected the draft: ${reasons.join("; ")}`,
        ...(opts.dryRun ? { question } : {}),
      });
      continue;
    }

    // Warnings do not block, but they hold the item at 'draft' so an editor
    // opens it deliberately rather than finding it in the review queue.
    const caseStatus: "pending_review" | "draft" =
      critic.findings.some((f) => f.severity === "warning") ? "draft" : "pending_review";

    if (opts.dryRun || !supabase) {
      results.push({
        id, domain: plan.domain, topic: plan.topic, title: question.title,
        jobId, renderJobId: null, caseId: null, status: "drafted", caseStatus, pmids, critic, question,
      });
      continue;
    }

    // ---- write the case ----
    const rows = questionToRows(question, null);
    const { data: caseRow, error: caseErr } = await supabase
      .from("eeg_cases")
      .insert({
        ...rows.case,
        status: caseStatus,
        ai_model: model,
        generation_job_id: jobId,
        created_by: opts.requestedBy ?? null,
        // no image yet — the render worker fills image_url in
        image_url: rows.case.image_url,
      })
      .select("id")
      .single();
    if (caseErr || !caseRow) {
      await fail(`could not write the case: ${caseErr?.message}`, { draft: question, critic_report: critic });
      continue;
    }
    const caseId = caseRow.id as string;

    if (rows.options.length) {
      await supabase.from("eeg_case_options")
        .insert(rows.options.map((o) => ({ ...o, case_id: caseId })));
    }
    if (rows.references.length) {
      await supabase.from("eeg_case_references")
        .insert(rows.references.map((r) => ({ ...r, case_id: caseId })));
    }

    // ---- enqueue the render ----
    const { data: renderRow, error: renderErr } = await supabase
      .from("eeg_case_render_jobs")
      .insert({ case_id: caseId, spec: question.image.spec, status: "pending" })
      .select("id")
      .single();
    if (renderErr) notes.push(`${id}: could not enqueue the render job — ${renderErr.message}`);

    await supabase.from("eeg_case_generation_jobs")
      .update({ status: "drafted", draft: question, critic_report: critic, case_id: caseId })
      .eq("id", jobId);

    stems.push({ id, stem: `${question.stem?.vignette ?? ""} ${question.stem?.lead_in ?? ""}` });
    results.push({
      id, domain: plan.domain, topic: plan.topic, title: question.title,
      jobId, renderJobId: renderRow?.id ?? null, caseId, status: "drafted", caseStatus, pmids, critic,
    });
  }

  return {
    provider, model, promptVersion: PROMPT_VERSION,
    planned, results, blueprintMissing: blueprint.length === 0, notes,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
