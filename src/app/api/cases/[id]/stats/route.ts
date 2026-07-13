import { NextRequest, NextResponse } from "next/server";
import { getCaseById, getCaseStats } from "@/lib/cases-server";

// Aggregate community stats for a case (no identities). Public.
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await getCaseById(id);
  if (!c || (c.status !== "published" && c.status !== "archived")) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }
  const stats = await getCaseStats(id);
  return NextResponse.json({ success: true, stats });
}
