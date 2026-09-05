import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";

// Poll a render job. Editor or admin.
//
// GET /api/admin/qbank/render?jobId=<uuid>
//
// The renderer is a Python worker (tools/eeg-render) that polls
// eeg_case_render_jobs, writes the PNG and fills in image_url + sidecar. This
// route only polls and reports the worker's result; the worker is the sole
// writer of case image attachments.
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data, error } = await supabase
    .from("eeg_case_render_jobs")
    .select("id,case_id,status,image_url,sidecar,error,spec")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (data.status === "done" && data.case_id && data.image_url) {
    const { data: current, error: currentErr } = await supabase
      .from("eeg_cases")
      .select("image_url,spec")
      .eq("id", data.case_id)
      .maybeSingle();
    const currentMatches = !currentErr && current
      && current.image_url === data.image_url
      && canonicalJson(current.spec) === canonicalJson(data.spec);
    if (!currentMatches) {
      return NextResponse.json({
        success: false,
        status: "superseded",
        imageUrl: current?.image_url ?? null,
        sidecar: data.sidecar ?? null,
        error: "Render job superseded by a newer image attachment or specification.",
      }, { status: 409 });
    }
  }

  return NextResponse.json({
    success: true,
    status: data.status,
    imageUrl: data.image_url ?? null,
    sidecar: data.sidecar ?? null,
    error: data.error ?? null,
  });
}
