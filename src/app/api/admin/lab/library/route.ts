import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole } from "@/lib/roles";
import {
  LIBRARY_CASE_COLUMNS, caseRowToQuestion, facets, matches, qbankIdOfRow, redactForLearner, rowToEntry,
  type LibraryEntry, type LibraryQuery, type LibraryQuestion,
} from "@/lib/lab/library";
import { canSeeRecording } from "@/lib/lab/visibility";
import { isLabReviewStatus, SYNTHETIC_STAMP } from "@/lib/lab/types";

export const runtime = "nodejs";

// The EEG Library: finished exports, searchable. Any signed-in member; the
// authored findings are editor-only (see redactForLearner).
//
// GET /api/admin/lab/library?q=&kind=&age=&background=&event=&domain=&source=&review=
//   -> { entries, facets, total, editor, role }
//
// Visibility (src/lib/lab/visibility.ts): members get published recordings;
// editors also get everything submitted for review and their own drafts;
// admins get all. `review` filters within what the caller may see:
// draft | pending_review | published | archived | legacy | mine.
//
// Reads job metadata and the linked question-bank row only. It never touches
// the recording files or the instructor answer key — the download route is
// the single gate for those.

/** Columns the library needs; smaller than LAB_JOB_COLUMNS on purpose. */
const COLUMNS =
  "id,status,spec,duration_s,formats,recording_id,spec_hash,renderer_version," +
  "artifacts,requested_by,created_at," +
  "review_status,author_id,source,qbank_id,title,description,grandfathered,submitted_at,published_at";
const PAGE = 500;

function param(request: NextRequest, name: string): string | null {
  const v = request.nextUrl.searchParams.get(name);
  return v && v.trim().length ? v.trim() : null;
}

export async function GET(request: NextRequest) {
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

  const visible = rows.filter((r) => canSeeRecording(auth, {
    reviewStatus: typeof r.review_status === "string" ? r.review_status : "draft",
    authorId: typeof r.author_id === "string" ? r.author_id : null,
  }));

  const qbankIds = Array.from(new Set(
    visible.map((r) => qbankIdOfRow(r)).filter((id): id is string => !!id),
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

  // Author emails for editors' cards (the learner view drops them).
  const authors = new Map<string, string>();
  if (editor) {
    const ids = Array.from(new Set(
      visible.map((r) => r.author_id).filter((id): id is string => typeof id === "string"),
    ));
    if (ids.length) {
      const { data } = await supabase.from("user_roles").select("user_id,email").in("user_id", ids);
      for (const row of (data ?? []) as { user_id: string | null; email: string }[]) {
        if (row.user_id) authors.set(row.user_id, row.email);
      }
    }
  }

  const all: LibraryEntry[] = visible.map((r) => {
    const entry = rowToEntry(r, cases, authors);
    return editor ? entry : redactForLearner(entry);
  });
  const source = param(request, "source");
  const review = param(request, "review");
  const query: LibraryQuery = {
    q: param(request, "q") ?? "",
    kind: param(request, "kind"),
    age: param(request, "age"),
    background: param(request, "background"),
    event: param(request, "event"),
    domain: param(request, "domain"),
    source: source === "bank" || source === "adhoc" ? source : null,
    review: editor && (isLabReviewStatus(review) || review === "legacy" || review === "mine") ? review : null,
    viewerId: auth.userId,
  };
  const entries = all.filter((e) => matches(e, query));

  return NextResponse.json({
    success: true,
    entries,
    facets: facets(all, auth.userId),
    total: all.length,
    editor,
    role: auth.role,
    stamp: SYNTHETIC_STAMP,
  }, {
    // 138 KB that changes a few times a day: let the browser reuse it for a
    // minute (back-navigation, filter changes) — private, never a shared cache
    headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
  });
}
