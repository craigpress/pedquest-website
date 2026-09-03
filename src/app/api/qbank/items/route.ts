import { NextRequest, NextResponse } from "next/server";
import { resolveCaller } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { getBankFacets, listBankItems } from "@/lib/qbank-server";
import type { Difficulty, QbankDomain, QbankPopulation, QbankSetting } from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The learner's browse list. Signed-in members only — the landing page shows
// facet counts to everyone and prompts anonymous visitors to sign in.
//
// GET /api/qbank/items?domain=&difficulty=&population=&setting=
export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (!caller) {
    // Not an error: the page renders a sign-in prompt from this.
    const facets = await getBankFacets();
    return NextResponse.json({ success: true, signedIn: false, items: [], facets, answered: [] });
  }

  const p = request.nextUrl.searchParams;
  const [items, facets] = await Promise.all([
    listBankItems({
      domain: (p.get("domain") as QbankDomain) || null,
      difficulty: (p.get("difficulty") as Difficulty) || null,
      population: (p.get("population") as QbankPopulation) || null,
      setting: (p.get("setting") as QbankSetting) || null,
    }),
    getBankFacets(),
  ]);

  // Which of these has this member already answered? Drives the "answered"
  // marker and the practice pool.
  let answered: string[] = [];
  const supabase = createServerClient();
  if (supabase) {
    const { data } = await supabase
      .from("eeg_responses")
      .select("case_id,is_correct")
      .eq("user_id", caller.userId);
    answered = ((data ?? []) as any[]).map((r) => r.case_id);
  }

  return NextResponse.json({ success: true, signedIn: true, items, facets, answered });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
