import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { LAB_JOB_COLUMNS, rowToJob } from "@/lib/lab/jobs";
import {
  eeglabConfigured, isEeglabPath, signEeglabUrl, streamProxyConfigured, streamSignature,
} from "@/lib/lab/eeglab-store";
import { isLabArtifact, LAB_BUCKET, LAB_SIGNED_URL_TTL_S } from "@/lib/lab/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same-origin byte proxy for one artifact of one lab job.
//
// GET|HEAD /api/admin/lab/jobs/<uuid>/stream?artifact=<a>&exp=<unix>&sig=<hex>
//
// WHY THIS EXISTS: the homelab recording store sends Access-Control-Allow-Origin
// for https://pedquest.org only, so the viewer's Range reads fail outright from
// http://localhost — a CORS preflight failure, not an auth failure, and no
// signed URL can fix it. Here the store is fetched server-side, where CORS is
// not a thing, and the bytes come back on this origin.
//
// WHY IT IS NOT AUTHENTICATED THE NORMAL WAY: the browser fetches this URL with
// no Bearer token — RangeByteSource.open() sends Range and nothing else. The
// `sig` IS the authentication: /download minted it only after requireRole and
// resolveArtifact both passed, so re-running the role gate here would be
// re-asking a question already answered by a caller we can no longer see. What
// this route still owns is the job state: a signature for an artifact that was
// never written, or a job that is not done, is refused.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Passed straight through from upstream; everything else is dropped. */
const PASS_THROUGH = [
  "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified",
];

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function serve(request: NextRequest, ctx: { params: Promise<{ id: string }> }, method: "GET" | "HEAD") {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return bad(400, "Not a job id.");

  const params = request.nextUrl.searchParams;
  const artifact = params.get("artifact") ?? "";
  const expRaw = params.get("exp") ?? "";
  const sig = params.get("sig") ?? "";
  if (!isLabArtifact(artifact)) return bad(400, "Unknown artifact.");
  if (!streamProxyConfigured()) return bad(503, "The recording proxy is not configured on this deployment.");

  const exp = Number(expRaw);
  if (!sig || !Number.isInteger(exp)) return bad(403, "This link is not signed.");

  // Compare before expiry so a forged link cannot learn an expiry from the
  // status code. timingSafeEqual throws on a length mismatch, hence the guard.
  const expected = Buffer.from(streamSignature(id, artifact, exp), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return bad(403, "This link is not valid.");
  }
  if (exp * 1000 < Date.now()) return bad(410, "This link has expired.");

  const supabase = createServerClient();
  if (!supabase) return bad(503, "The teaching lab is not configured.");

  const { data, error } = await supabase
    .from("eeg_lab_jobs")
    .select(LAB_JOB_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[EEG Lab] stream lookup failed:", error.message);
    return bad(500, "Could not read the job.");
  }
  if (!data) return bad(404, "Job not found.");

  const job = rowToJob(data);
  if (job.status !== "done") return bad(409, `The job is ${job.status}; nothing has been written yet.`);
  const path = job.artifacts?.[artifact];
  if (!path) return bad(404, `This job produced no ${artifact} artifact.`);

  let upstreamUrl: string;
  if (isEeglabPath(path)) {
    if (!eeglabConfigured()) return bad(503, "The recording store is not configured on this deployment.");
    // Short: this URL exists only for the length of the fetch below.
    upstreamUrl = signEeglabUrl(path, 120);
  } else {
    const { data: signed, error: signError } = await supabase
      .storage
      .from(LAB_BUCKET)
      .createSignedUrl(path, LAB_SIGNED_URL_TTL_S);
    if (signError || !signed?.signedUrl) {
      console.error("[EEG Lab] stream signing failed:", signError?.message);
      return bad(500, "Could not open that artifact.");
    }
    upstreamUrl = signed.signedUrl;
  }

  const forward = new Headers();
  const range = request.headers.get("range");
  if (range) forward.set("Range", range);
  const inm = request.headers.get("if-none-match");
  if (inm) forward.set("If-None-Match", inm);
  // The reader's chunk maths assume the byte offsets it asked for.
  forward.set("Accept-Encoding", "identity");

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method, headers: forward, cache: "no-store" });
  } catch (cause) {
    console.error("[EEG Lab] stream upstream failed:", cause instanceof Error ? cause.message : cause);
    return bad(502, "The recording store did not answer.");
  }

  const headers = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");

  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return serve(request, ctx, "GET");
}

export async function HEAD(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return serve(request, ctx, "HEAD");
}
