import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

// Async AI image generation. Vercel (Hobby, 60s cap) cannot wait out the ~80s
// generation, so we ENQUEUE a job and a homelab worker processes it, uploads
// the PNG to the eeg-cases bucket, and writes the URL back. The client polls
// GET ?jobId=… until status is 'done' (or 'error').
//
// POST { description }            -> { success, jobId }
// GET  ?jobId=<uuid>              -> { success, status, imageUrl, error }

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let body: { description?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const description = String(body.description || "").trim();
  if (!description) return NextResponse.json({ error: "An image description is required." }, { status: 400 });
  if (description.length > 2000) return NextResponse.json({ error: "Description is too long." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data, error } = await supabase
    .from("eeg_case_image_jobs")
    .insert({ description, status: "pending", requested_by: auth.userId })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[CaseImageGen] enqueue failed:", error?.message);
    return NextResponse.json({ error: "Could not queue image generation." }, { status: 500 });
  }
  return NextResponse.json({ success: true, jobId: data.id });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data, error } = await supabase
    .from("eeg_case_image_jobs")
    .select("status,image_url,error")
    .eq("id", jobId)
    .single();
  if (error || !data) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  return NextResponse.json({
    success: true,
    status: data.status,
    imageUrl: data.image_url ?? null,
    error: data.error ?? null,
  });
}
