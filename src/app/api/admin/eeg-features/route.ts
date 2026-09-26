import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { EEG_REFERENCES } from "@/lib/eeg-reference";
const valid = (source: unknown, id: unknown) => (source === "lab" || source === "qbank") && typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor"); if (!auth.ok) return auth.response;
  const source = request.nextUrl.searchParams.get("source"), id = request.nextUrl.searchParams.get("id");
  if (!valid(source,id)) return NextResponse.json({ error: "Invalid resource" }, { status: 400 });
  const db = createServerClient(); if (!db) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { data, error } = await db.from("eeg_feature_corrections").select("feature_id,disposition").eq("source", source).eq("resource_id",id);
  return NextResponse.json(error ? { error: "Unavailable" } : { corrections: data }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor"); if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || !valid(body.source,body.id) || !EEG_REFERENCES.some((r)=>r.id === body.featureId) || !["confirmed_mention","dismissed","reset"].includes(body.disposition)) return NextResponse.json({ error: "Invalid correction" }, { status: 400 });
  const db = createServerClient(); if (!db) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const result = body.disposition === "reset"
    ? await db.from("eeg_feature_corrections").delete().eq("source",body.source).eq("resource_id",body.id).eq("feature_id",body.featureId)
    : await db.from("eeg_feature_corrections").upsert({ source:body.source, resource_id:body.id, feature_id:body.featureId, disposition:body.disposition });
  return NextResponse.json(result.error ? { error: "Correction not saved" } : { saved:true }, { status: result.error ? 503 : 200 });
}
