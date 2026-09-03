import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { QBANK_DOMAINS } from "@/lib/cases";
import { generateDrafts } from "@/lib/qbank/generate";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  let body: { domain?: unknown; prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const domain = String(body.domain ?? "").trim();
  const prompt = String(body.prompt ?? "").trim();
  if (!QBANK_DOMAINS.includes(domain as (typeof QBANK_DOMAINS)[number])) {
    return NextResponse.json({ error: "Choose a valid question-bank domain." }, { status: 400 });
  }
  if (prompt.length < 15) {
    return NextResponse.json({ error: "Describe the clinical concept to test in at least 15 characters." }, { status: 400 });
  }
  if (prompt.length > 1200) {
    return NextResponse.json({ error: "The prompt must be 1,200 characters or fewer." }, { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Question generation is not configured." }, { status: 503 });
  }

  try {
    const summary = await generateDrafts(supabase, {
      count: 1,
      domain,
      topic: prompt,
      requestedBy: auth.userId,
      budgetMs: 260_000,
      timeoutMs: 120_000,
    });
    const item = summary.results[0];
    if (!item || item.status === "failed" || !item.caseId) {
      return NextResponse.json({
        error: item?.error ?? "The generator did not produce a reviewable question.",
        notes: summary.notes,
      }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      item: {
        id: item.caseId,
        qbankId: item.id,
        title: item.title,
        status: item.caseStatus,
        renderJobId: item.renderJobId,
        pmids: item.pmids,
      },
      provider: summary.provider,
      model: summary.model,
      notes: summary.notes,
    }, { status: 201 });
  } catch (error) {
    console.error("[Qbank Generate]", error);
    return NextResponse.json({ error: "Question generation failed unexpectedly." }, { status: 500 });
  }
}
