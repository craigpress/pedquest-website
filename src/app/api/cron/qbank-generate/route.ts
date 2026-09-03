import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { generateDrafts } from "@/lib/qbank/generate";
import { drainRevisionJobs } from "@/lib/qbank/revise";
import { notifyEditorsOfPendingItems } from "@/lib/qbank/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Weekly question-bank generation. Guarded by CRON_SECRET, the same way
// /api/scan-publications is — Vercel Cron sends it as a Bearer token.
//
//   GET /api/cron/qbank-generate?count=3
//
// Nothing this route produces is published. Drafts land as `pending_review`
// (or `draft` when the critic raised warnings) and the DB publish gate still
// requires a license, a verified reference and a second reviewer.
//
// TIME BUDGET: Vercel caps function duration (60s on Hobby), so the
// orchestrator stops starting new drafts once QBANK_GENERATE_BUDGET_MS has
// elapsed and reports what it skipped. Lower `count` or run the route more
// often rather than raising the budget past the platform limit.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server not configured." }, { status: 503 });
  }

  const countParam = Number(request.nextUrl.searchParams.get("count") ?? "3");
  const count = Number.isFinite(countParam) ? Math.max(1, Math.min(countParam, 10)) : 3;
  const budgetMs = Number(process.env.QBANK_GENERATE_BUDGET_MS ?? 45000);
  const llmTimeoutMs = Number(process.env.QBANK_LLM_TIMEOUT_MS ?? 40000);

  // Drain editor-requested revisions first — a "request changes" on an AI item
  // queues one; process a few before spending the remaining budget on new drafts.
  const revisions = await drainRevisionJobs(supabase, {
    limit: 3, timeoutMs: llmTimeoutMs, budgetMs: Math.floor(budgetMs / 2),
  });

  const summary = await generateDrafts(supabase, {
    count,
    budgetMs,
    timeoutMs: llmTimeoutMs,
  });

  const drafted = summary.results.filter((r) => r.status === "drafted" && r.caseId);
  let notified = 0;
  if (drafted.length) {
    notified = await notifyEditorsOfPendingItems(
      supabase,
      drafted.map((r) => ({
        qbankId: r.id,
        title: r.title ?? r.id,
        domain: r.domain,
        caseId: r.caseId!,
        caseStatus: r.caseStatus ?? "pending_review",
      })),
      { origin: request.nextUrl.origin, source: "weekly generation cron" },
    );
  }

  return NextResponse.json({
    success: true,
    provider: summary.provider,
    model: summary.model,
    promptVersion: summary.promptVersion,
    requested: count,
    drafted: drafted.length,
    failed: summary.results.filter((r) => r.status === "failed").length,
    revisions: {
      processed: revisions.length,
      succeeded: revisions.filter((r) => r.ok).length,
      failed: revisions.filter((r) => !r.ok).length,
    },
    editorsNotified: notified,
    blueprintMissing: summary.blueprintMissing,
    notes: summary.notes,
    items: summary.results.map((r) => ({
      id: r.id,
      domain: r.domain,
      topic: r.topic,
      status: r.status,
      caseStatus: r.caseStatus ?? null,
      caseId: r.caseId,
      jobId: r.jobId,
      pmids: r.pmids,
      criticScore: r.critic?.score ?? null,
      error: r.error ?? null,
    })),
  });
}
