import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole } from "@/lib/roles";
import { LAB_JOB_COLUMNS, rowToJob } from "@/lib/lab/jobs";
import { SYNTHETIC_STAMP, type LabJob } from "@/lib/lab/types";

export const runtime = "nodejs";

// Poll one EEG Teaching Lab job. Any signed-in member may read a job (the
// viewer needs it); only editors receive the spec, the report and the
// follow-on stages, because the spec is the authored ground truth.
//
// GET /api/admin/lab/jobs/<uuid>
//   -> { job, children }
//
// `children` are the follow-on stages this export spawned — a `persyst` row
// carries parent_job_id = this id. They are separate rows on purpose: the
// export can succeed, be inspected, and be reprocessed without being redone,
// and PSCLI /Process faults with 0xC0000005 on roughly one run in three, so a
// Persyst failure must not condemn a good recording.
//
// This route only reports what the worker wrote. It never starts, retries or
// completes a job.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth.response;
  const editor = hasRole(auth.role, "editor");

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not a job id." }, { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("eeg_lab_jobs")
    .select(LAB_JOB_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[EEG Lab] poll failed:", error.message);
    return NextResponse.json({ error: "Could not read the job." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (!editor) {
    const job: LabJob = { ...rowToJob(data), spec: null, report: null };
    return NextResponse.json({
      success: true, job, children: [], stamp: SYNTHETIC_STAMP,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const { data: children } = await supabase
    .from("eeg_lab_jobs")
    .select(LAB_JOB_COLUMNS)
    .eq("parent_job_id", id)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    success: true,
    job: rowToJob(data),
    children: (children ?? []).map((row) => rowToJob(row)),
    stamp: SYNTHETIC_STAMP,
  }, { headers: { "Cache-Control": "no-store" } });
}
