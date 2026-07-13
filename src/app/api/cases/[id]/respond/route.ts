import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { checkOrigin, truncate } from "@/lib/validation";
import { getCaseById, getCaseStats } from "@/lib/cases-server";
import { isPointInRegion, type RevealResult } from "@/lib/cases";

// Submit an answer to a case, grade it server-side, and return the reveal.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  const ip = getClientIp(request);
  if (isRateLimited(ip, "case-respond", 40)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { id } = await ctx.params;

  let body: { selectedOptionId?: string; pointedX?: number; pointedY?: number; sessionId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Server not configured." }, { status: 503 });

  const c = await getCaseById(id);
  if (!c || (c.status !== "published" && c.status !== "archived")) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  // ----- resolve responder (member if a valid token is sent, else anonymous session) -----
  let userId: string | null = null;
  let memberEmail: string | null = null;
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    if (data?.user) { userId = data.user.id; memberEmail = data.user.email ?? null; }
  }
  const sessionId = userId ? null : truncate(String(body.sessionId || "").trim(), 100) || null;
  if (!userId && !sessionId) {
    return NextResponse.json({ error: "Missing session identifier." }, { status: 400 });
  }

  // ----- grade -----
  let selectedOptionId: string | null = null;
  let px: number | null = null;
  let py: number | null = null;
  let isCorrect = false;

  if (c.questionType === "multiple_choice") {
    selectedOptionId = String(body.selectedOptionId || "");
    const opt = c.options.find((o) => o.id === selectedOptionId);
    if (!opt) return NextResponse.json({ error: "Invalid option." }, { status: 400 });
    isCorrect = opt.isCorrect;
  } else {
    px = Number(body.pointedX);
    py = Number(body.pointedY);
    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || px > 1 || py < 0 || py > 1) {
      return NextResponse.json({ error: "Invalid point." }, { status: 400 });
    }
    isCorrect = !!c.correctRegion && isPointInRegion(c.correctRegion, px, py, c.regionTolerance ?? 0);
  }

  // ----- dedupe: one response per member / per anon session -----
  const existingQuery = supabase.from("eeg_responses").select("id,selected_option_id,pointed_x,pointed_y,is_correct").eq("case_id", id).limit(1);
  const { data: existingRows } = userId
    ? await existingQuery.eq("user_id", userId)
    : await existingQuery.is("user_id", null).eq("session_id", sessionId);

  let alreadyAnswered = false;
  if (existingRows && existingRows.length > 0) {
    alreadyAnswered = true;
    const e = existingRows[0] as Record<string, unknown>;
    // keep the user's ORIGINAL answer for the reveal (don't overwrite / double-count)
    selectedOptionId = (e.selected_option_id as string) ?? selectedOptionId;
    px = e.pointed_x != null ? Number(e.pointed_x) : px;
    py = e.pointed_y != null ? Number(e.pointed_y) : py;
    isCorrect = !!e.is_correct;
  } else {
    const { error: insErr } = await supabase.from("eeg_responses").insert({
      case_id: id,
      user_id: userId,
      session_id: sessionId,
      member_email: memberEmail,
      selected_option_id: selectedOptionId,
      pointed_x: px,
      pointed_y: py,
      is_correct: isCorrect,
    });
    if (insErr) {
      console.error("[CaseRespond] insert failed:", insErr.message);
      // unique-violation race → treat as already answered rather than 500
      alreadyAnswered = true;
    }
  }

  const stats = await getCaseStats(id);

  const optionExplanations: RevealResult["optionExplanations"] = {};
  let correctOptionId: string | null = null;
  for (const o of c.options) {
    optionExplanations[o.id] = { isCorrect: o.isCorrect, explanation: o.optionExplanation };
    if (o.isCorrect) correctOptionId = o.id;
  }

  const reveal: RevealResult = {
    correct: isCorrect,
    correctOptionId,
    optionExplanations,
    correctRegion: c.correctRegion,
    explanation: c.explanation,
    teachingPoints: c.teachingPoints,
    yourAnswer: { optionId: selectedOptionId, x: px, y: py },
    stats,
    alreadyAnswered,
  };
  return NextResponse.json({ success: true, reveal });
}
