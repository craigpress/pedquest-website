import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole } from "@/lib/roles";
import {
  LIBRARY_CASE_COLUMNS, caseRowToQuestion, facets, matches, qbankIdOf, redactForLearner, rowToEntry,
  type LibraryEntry, type LibraryQuery, type LibraryQuestion,
} from "@/lib/lab/library";
import { SYNTHETIC_STAMP } from "@/lib/lab/types";

export const runtime = "nodejs";

// The EEG Library: every finished export, searchable. Any signed-in member;
// the authored findings are editor-only (see redactForLearner).
//
// GET /api/admin/lab/library?q=&kind=&age=&background=&event=&domain=&source=
//   -> { entries, facets, total, editor }
//
// Reads job metadata and the linked question-bank row only. It never touches
// the recording files or the instructor answer key — the download route is
// the single gate for those.

/** Columns the library needs; smaller than LAB_JOB_COLUMNS on purpose. */
const COLUMNS =
  "id,status,spec,duration_s,formats,recording_id,spec_hash,renderer_version," +
  "artifacts,requested_by,created_at";
const PAGE = 500;

function param(request: NextRequest, name: string): string | null {
  const v = request.nextUrl.searchParams.get(name);
  return v && v.trim().length ? v.trim() : null;
}

export async function GET(request: NextRequest) {
  // Any signed-in member may browse; editors see the authored findings, everyone
  // else gets the learner view (redactForLearner) so a bank question's answer
  // is not readable off its recording's card.
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth.response;
  const editor = hasRole(auth.role, "editor");

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  }

  // Finished exports only. Page through in case the library outgrows one call.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("eeg_lab_jobs")
      .select(COLUMNS)
      .eq("stage", "export")
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("[EEG Library] list failed:", error.message);
      return NextResponse.json({ error: "Could not load the library." }, { status: 500 });
    }
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }

  const qbankIds = Array.from(new Set(
    rows.map((r) => qbankIdOf(typeof r.requested_by === "string" ? r.requested_by : null))
      .filter((id): id is string => !!id),
  ));
  const cases = new Map<string, LibraryQuestion>();
  if (qbankIds.length) {
    const { data, error } = await supabase
      .from("eeg_cases")
      .select(LIBRARY_CASE_COLUMNS)
      .in("qbank_id", qbankIds);
    if (error) {
      // The recordings are still worth listing without their questions.
      console.error("[EEG Library] case lookup failed:", error.message);
    }
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const q = caseRowToQuestion(row);
      if (q) cases.set(q.qbankId, q);
    }
  }

  const all: LibraryEntry[] = rows.map((r) => {
    const entry = rowToEntry(r, cases);
    return editor ? entry : redactForLearner(entry);
  });
  const source = param(request, "source");
  const query: LibraryQuery = {
    q: param(request, "q") ?? "",
    kind: param(request, "kind"),
    age: param(request, "age"),
    background: param(request, "background"),
    event: param(request, "event"),
    domain: param(request, "domain"),
    source: source === "bank" || source === "adhoc" ? source : null,
  };
  const entries = all.filter((e) => matches(e, query));

  return NextResponse.json({
    success: true,
    entries,
    facets: facets(all),
    total: all.length,
    editor,
    stamp: SYNTHETIC_STAMP,
  });
}
