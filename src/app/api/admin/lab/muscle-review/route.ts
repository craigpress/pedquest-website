import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import trials from "@/data/eeg-muscle-review.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const trial = trials.find((item) => item.id === request.nextUrl.searchParams.get("recording"));
  if (!trial) return NextResponse.json({ error: "Recording not found." }, { status: 404, headers: NO_STORE });
  const sb = createServerClient();
  if (!sb) return NextResponse.json({ error: "Server not configured." }, { status: 503, headers: NO_STORE });
  const { data, error } = await sb.storage.from("eeg-gallery").createSignedUrl(
    `experiments/muscle-20261001/${trial.sha256}.edf`, 900, { download: trial.file },
  );
  if (error || !data) {
    return NextResponse.json({ error: "Could not open this recording." }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ url: data.signedUrl }, { headers: NO_STORE });
}
