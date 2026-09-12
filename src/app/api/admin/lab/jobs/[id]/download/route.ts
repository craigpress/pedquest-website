import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole } from "@/lib/roles";
import { LAB_JOB_COLUMNS, resolveArtifact, rowToJob } from "@/lib/lab/jobs";
import { eeglabConfigured, isEeglabPath, signEeglabUrl } from "@/lib/lab/eeglab-store";
import {
  isLabArtifact, LAB_ARTIFACT_LABELS, LAB_BUCKET, LAB_SIGNED_URL_TTL_S, SYNTHETIC_STAMP,
} from "@/lib/lab/types";

export const runtime = "nodejs";

// Issue a short-lived signed URL for one artifact of one lab job.
//
// GET /api/admin/lab/jobs/<uuid>/download?artifact=lay|dat|edf|answers
//   (trends_csv is also served, under the same instructor gate as answers)
//
// The `eeg-lab` bucket is private — deliberately not `eeg-cases`, which is
// public with an anonymous SELECT policy and would hand every learner the
// instructor copy no matter how this page was gated. Everything leaves through
// a signed URL that expires in LAB_SIGNED_URL_TTL_S seconds.
//
// TWO INDEPENDENT GATES, and that is the point:
//
//   1. requireRole(request, "editor") — this lives under /api/admin, like every
//      other route there.
//   2. resolveArtifact(..., callerIsEditor) — re-checks the caller's role for
//      `answers` and `trends_csv` specifically. It is redundant today. It stops
//      being redundant the moment anyone relaxes gate 1 to let learners fetch
//      their own recording, which is the obvious next feature. The answer key
//      is the instructor copy and must refuse on its own terms.
//
// The learner artifacts are safe to hand out because of what the WORKER does,
// not because of what this route withholds: `eeg-render export --answers` — the
// flag that writes realized events into the .lay / EDF+ annotation stream — is
// pinned off for every job (see buildJobOptions). Withholding a written answer
// does not blind a case whose file annotations give it away.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not a job id." }, { status: 400 });
  }

  const artifact = request.nextUrl.searchParams.get("artifact") ?? "";
  if (!isLabArtifact(artifact)) {
    return NextResponse.json({
      error: "artifact must be one of lay, dat, edf, answers, trends_csv.",
    }, { status: 400 });
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
    console.error("[EEG Lab] download lookup failed:", error.message);
    return NextResponse.json({ error: "Could not read the job." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const job = rowToJob(data);
  const decision = resolveArtifact(job, artifact, hasRole(auth.role, "editor"));
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }

  // Two stores. Rows written by tools/eeg-render/lab_worker.py point at the
  // homelab recording store (eeglab://…) and get a nginx secure_link URL;
  // older rows still hold Supabase Storage paths and are signed there.
  let url: string;
  if (isEeglabPath(decision.path)) {
    if (!eeglabConfigured()) {
      return NextResponse.json({
        error: "The recording store is not configured on this deployment (EEG_LAB_BASE_URL / EEG_LAB_URL_SECRET).",
      }, { status: 503 });
    }
    url = signEeglabUrl(decision.path, LAB_SIGNED_URL_TTL_S);
  } else {
    const { data: signed, error: signError } = await supabase
      .storage
      .from(LAB_BUCKET)
      .createSignedUrl(decision.path, LAB_SIGNED_URL_TTL_S, {
        download: decision.path.split("/").pop() ?? true,
      });
    if (signError || !signed?.signedUrl) {
      console.error("[EEG Lab] signing failed:", signError?.message);
      return NextResponse.json({
        error: "Could not issue a download link for that artifact.",
      }, { status: 500 });
    }
    url = signed.signedUrl;
  }

  return NextResponse.json({
    success: true,
    artifact,
    label: LAB_ARTIFACT_LABELS[artifact],
    instructorCopy: decision.instructorCopy,
    url,
    expiresInS: LAB_SIGNED_URL_TTL_S,
    expiresAt: new Date(Date.now() + LAB_SIGNED_URL_TTL_S * 1000).toISOString(),
    recordingId: job.recordingId,
    stamp: SYNTHETIC_STAMP,
  }, {
    // A signed URL must never sit in a shared cache or a CDN.
    headers: { "Cache-Control": "no-store, private" },
  });
}
