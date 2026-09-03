import { NextRequest, NextResponse } from "next/server";
import { resolveCaller } from "@/lib/admin-auth";
import { getPublicBankItem, pickUnansweredItem } from "@/lib/qbank-server";
import type { Difficulty, QbankDomain, QbankPopulation, QbankSetting } from "@/lib/cases";

// Practice mode: serve a random published bank item the caller has not answered.
// Signed in only — "unanswered" is meaningless without an identity, and the
// point of practice mode is that progress accumulates.
//
// GET /api/qbank/practice?domain=&difficulty=&population=&setting=
// -> { item } (answer-stripped) or { exhausted: true }
export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ error: "Please sign in to use practice mode." }, { status: 401 });
  }

  const p = request.nextUrl.searchParams;
  const pick = await pickUnansweredItem(caller.userId, {
    domain: (p.get("domain") as QbankDomain) || null,
    difficulty: (p.get("difficulty") as Difficulty) || null,
    population: (p.get("population") as QbankPopulation) || null,
    setting: (p.get("setting") as QbankSetting) || null,
  });
  if (!pick) {
    return NextResponse.json({ success: true, exhausted: true, item: null });
  }

  const item = await getPublicBankItem(pick.id);
  if (!item) {
    return NextResponse.json({ success: true, exhausted: true, item: null });
  }
  return NextResponse.json({ success: true, exhausted: false, item });
}
