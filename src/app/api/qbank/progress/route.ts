import { NextRequest, NextResponse } from "next/server";
import { resolveCaller } from "@/lib/admin-auth";
import { getBankProgress } from "@/lib/qbank-server";

// "My progress" — per-domain answered/correct counts for the signed-in member,
// computed from eeg_responses server-side so a client cannot inflate it.
export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Please sign in to see your progress." }, { status: 401 });
  }
  const progress = await getBankProgress(caller.userId);
  return NextResponse.json({ success: true, progress });
}
