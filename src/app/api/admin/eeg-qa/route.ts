import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { eeglabConfigured, signEeglabUrl } from "@/lib/lab/eeglab-store";
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const source = request.nextUrl.searchParams.get("source");
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (source !== "lab" && source !== "qbank") return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  if (jobId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  const db = createServerClient();
  if (!db) return NextResponse.json({ error: "Visual QA unavailable" }, { status: 503 });
  let query = db.from("eeg_visual_qa").select("id,job_id,source,status,created_at,model,report,context").eq("source", source).order("created_at", { ascending: false }).limit(100);
  if (jobId) query = query.eq("job_id", jobId);
  else query = query.neq("status", "pass");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Visual QA unavailable" }, { status: 503 });
  const titles = new Map<string, string>();
  if (data?.length) {
    if (source === "lab") {
      const { data: jobs } = await db.from("eeg_lab_jobs").select("id,recording_id").in("id", data.map((r) => r.job_id));
      jobs?.forEach((j) => { if (j.recording_id) titles.set(j.id, j.recording_id); });
    } else {
      const ids = data.map((r) => r.context?.case_id).filter((id): id is string => typeof id === "string");
      if (ids.length) {
        const { data: cases } = await db.from("eeg_cases").select("id,qbank_id,title").in("id", ids);
        cases?.forEach((c) => titles.set(c.id, [c.qbank_id, c.title].filter(Boolean).join(" · ")));
      }
    }
  }
  const reviews = (data ?? []).map(({context,...row}) => {
    const paths: unknown[] = Array.isArray(context?.evidence_paths) ? context.evidence_paths : [];
    const evidence = source === "lab" && eeglabConfigured() ? paths.filter((p): p is string =>
      typeof p === "string" && /^eeglab:\/\/[A-Za-z0-9_-]+\/qa-(raw-[1-5]|trends)\.png$/.test(p)).map((p)=>signEeglabUrl(p,600)) : [];
    return {...row, title: titles.get(source === "lab" ? row.job_id : context?.case_id), report: evidence.length ? {...row.report,evidence_urls:evidence} : row.report,
      review_url: source === "lab" ? `/admin/eeg-lab/library/${row.job_id}` : context?.case_id ? `/admin/qbank/${context.case_id}` : "/admin/qbank" };
  });
  return NextResponse.json({ reviews }, { headers: { "Cache-Control": "no-store" } });
}
