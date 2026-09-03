import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { citationMatches, describeRecord, verifyPmid } from "@/lib/qbank/verify";

// Verify one PMID against PubMed. Editor or admin.
//
// GET /api/admin/qbank/verify-pmid?pmid=21832222&citation=<optional>
//
// Returns the PubMed record plus, when a citation is supplied, whether that
// citation's first author and year agree with it — a PMID that resolves but
// belongs to a different paper is the mistake worth catching.
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const pmid = (request.nextUrl.searchParams.get("pmid") ?? "").trim();
  if (!pmid) return NextResponse.json({ error: "Missing pmid." }, { status: 400 });

  const record = await verifyPmid(pmid);
  const citation = request.nextUrl.searchParams.get("citation");
  const match = citation ? citationMatches(citation, record) : null;

  return NextResponse.json({
    success: true,
    record,
    summary: describeRecord(record),
    match,
    /** safe to write into eeg_case_references.verified */
    verified: record.exists && (!match || match.ok),
    verifiedBy: `PubMed esummary, checked by ${auth.email}`,
  });
}
