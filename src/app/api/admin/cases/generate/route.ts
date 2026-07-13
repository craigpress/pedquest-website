import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { generateCaseDraft, generatorConfigured } from "@/lib/case-generator";

// Draft a qEEG case with AI (via OpenWebUI -> Claude). Lands in 'pending_review'.
// A human must attach a de-identified image and approve before it can publish.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  if (!generatorConfigured()) {
    return NextResponse.json(
      { error: "AI generator not configured. Set OPENWEBUI_BASE_URL, OPENWEBUI_API_KEY, OPENWEBUI_MODEL." },
      { status: 503 },
    );
  }

  let body: { topic?: string; difficulty?: string; questionType?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const topic = String(body.topic || "").trim();
  if (!topic) return NextResponse.json({ error: "A topic or finding is required." }, { status: 400 });

  let draft;
  try {
    draft = await generateCaseDraft({
      topic,
      difficulty: (["introductory", "intermediate", "advanced"].includes(String(body.difficulty)) ? body.difficulty : "intermediate") as never,
      questionType: (body.questionType === "point_to_feature" ? "point_to_feature" : "multiple_choice") as never,
    });
  } catch (e) {
    console.error("[CaseGenerate] failed:", (e as Error).message);
    return NextResponse.json({ error: `Generation failed: ${(e as Error).message}` }, { status: 502 });
  }

  const supabase = createServerClient()!;
  const { data, error } = await supabase.from("eeg_cases").insert({
    title: draft.title,
    clinical_vignette: draft.clinicalVignette,
    image_url: "",                       // human attaches a de-identified image on review
    question_type: draft.questionType,
    question_prompt: draft.questionPrompt,
    explanation: draft.explanation,
    teaching_points: draft.teachingPoints,
    difficulty: draft.difficulty,
    tags: draft.tags,
    source: "ai",
    ai_source_url: draft.referenceUrl || null,
    ai_model: process.env.OPENWEBUI_MODEL || null,
    status: "pending_review",
    created_by: auth.userId,
  }).select("id").single();

  if (error || !data) {
    console.error("[CaseGenerate] insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save the draft." }, { status: 500 });
  }

  if (draft.questionType === "multiple_choice" && draft.options.length) {
    await supabase.from("eeg_case_options").insert(
      draft.options.map((o, i) => ({
        case_id: data.id, label: o.label, is_correct: o.isCorrect,
        option_explanation: o.optionExplanation, sort_order: i,
      })),
    );
  }

  return NextResponse.json({
    success: true,
    id: data.id,
    draft,
    note: "Draft saved for review. Attach a de-identified image, verify the answer, then approve & publish.",
  });
}
