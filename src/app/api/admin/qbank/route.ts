import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { getQueueCounts, listEditorQueue } from "@/lib/qbank-server";
import type { Difficulty, QbankDomain, QbankPopulation, QbankSetting } from "@/lib/cases";

// Editor review queue. Editor or admin.
//
// GET /api/admin/qbank?status=pending_review&domain=foundations&difficulty=…
//                     &population=…&setting=…&bank=1
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const p = request.nextUrl.searchParams;
  const [items, counts] = await Promise.all([
    listEditorQueue({
      status: p.get("status") || null,
      source: p.get("source") || null,
      domain: (p.get("domain") as QbankDomain) || null,
      difficulty: (p.get("difficulty") as Difficulty) || null,
      population: (p.get("population") as QbankPopulation) || null,
      setting: (p.get("setting") as QbankSetting) || null,
      inBankOnly: p.get("bank") === "1",
      limit: Number(p.get("limit") ?? 300),
    }),
    getQueueCounts(),
  ]);

  return NextResponse.json({ success: true, items, counts, role: auth.role });
}
