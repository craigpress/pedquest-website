import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";

// Poll a render job. Editor or admin.
//
// GET /api/admin/qbank/render?jobId=<uuid>
//
// The renderer is a Python worker (tools/eeg-render) that polls
// eeg_case_render_jobs, writes the PNG and fills in image_url + sidecar. When a
// job reports 'done' this route also copies the result onto the case, so the
// editor console does not need a second write path.
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data, error } = await supabase
    .from("eeg_case_render_jobs")
    .select("id,case_id,status,image_url,sidecar,error")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (data.status === "done" && data.case_id && data.image_url) {
    const sidecar = data.sidecar as Record<string, unknown> | null;
    const patch: Record<string, unknown> = {
      image_url: data.image_url,
      image_sidecar: sidecar,
    };
    if (sidecar) {
      if (typeof sidecar.width === "number") patch.image_width = sidecar.width;
      if (typeof sidecar.height === "number") patch.image_height = sidecar.height;
      const region = sidecar.answer_region ?? sidecar.region;
      if (region && typeof region === "object") patch.correct_region = region;
    }
    const { error: applyErr } = await supabase.from("eeg_cases").update(patch).eq("id", data.case_id);
    if (applyErr) console.error("[Qbank] could not apply render result:", applyErr.message);
  }

  return NextResponse.json({
    success: true,
    status: data.status,
    imageUrl: data.image_url ?? null,
    sidecar: data.sidecar ?? null,
    error: data.error ?? null,
  });
}
