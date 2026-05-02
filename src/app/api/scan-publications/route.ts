import { NextRequest, NextResponse } from "next/server";
import { members } from "@/data/members";
import { searchPubMedByAuthor, fetchArticleByPmid, PubMedArticle } from "@/lib/pubmed";
import { sendDiscordNotification } from "@/lib/notifications";
import { createServerClient } from "@/lib/supabase";
import authorMapData from "../../../../author_map.json";
import committeePmidsData from "../../../../committee_pmids.json";

const authorMap: Record<string, string> = authorMapData;
const knownPmids: string[] = committeePmidsData as string[];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMinDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function memberIdToName(memberId: string): string {
  const member = members.find((m) => m.id === memberId);
  return member ? member.name : memberId;
}

export async function GET(request: NextRequest) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const minDate = getMinDate();
  const errors: string[] = [];
  const newArticles: Array<PubMedArticle & { memberId: string }> = [];
  const seenPmids = new Set<string>(knownPmids.map(String));
  let scanned = 0;

  // Also load already-logged PMIDs from Supabase (publications + auto_discovered log).
  // Both sources matter: a failed publications insert in the past should still be skipped
  // if it was logged as auto_discovered.
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("publications")
        .select("pmid")
        .not("pmid", "is", null);
      if (error) {
        errors.push(`Supabase publications read failed: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          if (row.pmid) seenPmids.add(String(row.pmid));
        }
      }
    } catch (e) {
      errors.push(`Supabase publications read threw: ${e}`);
    }

    try {
      const { data, error } = await supabase
        .from("publication_update_log")
        .select("pmid")
        .eq("action", "auto_discovered")
        .not("pmid", "is", null);
      if (error) {
        errors.push(`Supabase update_log read failed: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          if (row.pmid) seenPmids.add(String(row.pmid));
        }
      }
    } catch (e) {
      errors.push(`Supabase update_log read threw: ${e}`);
    }
  }

  for (const [surname, memberId] of Object.entries(authorMap)) {
    const memberName = memberIdToName(memberId);
    try {
      await delay(350);
      const pmids = await searchPubMedByAuthor(memberName, minDate);
      scanned++;

      const newPmids = pmids.filter((id) => !seenPmids.has(id));
      if (newPmids.length === 0) continue;

      for (const pmid of newPmids) {
        await delay(350);
        try {
          const article = await fetchArticleByPmid(pmid);
          if (!article) continue;

          // PubMed esearch can return a search-result PMID that efetch resolves to a
          // DIFFERENT canonical PMID (merged/republished records). The seenPmids set
          // is keyed on canonical PMIDs (from publications + committee_pmids), so we
          // must re-check using article.pmid before treating it as new.
          if (seenPmids.has(article.pmid) || seenPmids.has(pmid)) {
            seenPmids.add(pmid);
            seenPmids.add(article.pmid);
            continue;
          }

          // Verify the author is actually a consortium member by matching surname
          const authorSurnames = article.authors.map((a) => a.split(" ")[0]);
          if (!authorSurnames.some((s) => s.toLowerCase() === surname.toLowerCase())) {
            continue;
          }

          seenPmids.add(pmid);
          seenPmids.add(article.pmid);
          newArticles.push({ ...article, memberId });

          // Persist to Supabase. supabase-js does NOT throw on DB errors — it returns
          // { error }. We must check it explicitly or schema drift goes silent again.
          let persisted = false;
          if (supabase) {
            try {
              const { error: pubErr } = await supabase.from("publications").upsert(
                {
                  id: `auto-${article.pmid}`,
                  pmid: article.pmid,
                  title: article.title,
                  authors: article.authors,
                  journal: article.journal,
                  year: article.year,
                  month: article.month,
                  abstract: article.abstract,
                  doi: article.doi,
                  pmcid: article.pmcid,
                  keywords: article.keywords,
                  mesh_terms: article.meshTerms,
                  publication_types: article.publicationTypes,
                  member_id: memberId,
                  discovered_at: new Date().toISOString(),
                },
                { onConflict: "pmid" }
              );
              if (pubErr) {
                errors.push(`publications upsert failed for PMID ${pmid}: ${pubErr.message}`);
              } else {
                persisted = true;
              }

              const { error: logErr } = await supabase.from("publication_update_log").insert({
                pmid: article.pmid,
                member_id: memberId,
                action: "auto_discovered",
                scanned_at: new Date().toISOString(),
              });
              if (logErr) {
                errors.push(`update_log insert failed for PMID ${pmid}: ${logErr.message}`);
              }
            } catch (e) {
              errors.push(`Supabase insert threw for PMID ${pmid}: ${e}`);
            }
          }

          // Only fire Discord notification once persistence (or its absence) is decided.
          // If the DB write failed, skip the announcement so we don't spam the channel
          // with the same PMID on every run.
          if (supabase && !persisted) {
            continue;
          }

          // Discord notification
          const highlightedAuthors = article.authors
            .map((a) => {
              const s = a.split(" ")[0];
              return s.toLowerCase() === surname.toLowerCase() ? `**${a}**` : a;
            })
            .join(", ");

          await sendDiscordNotification({
            title: "\ud83d\udcc4 New Publication Found",
            color: 0x3498db,
            fields: [
              { name: "Title", value: article.title },
              { name: "Authors", value: highlightedAuthors },
              { name: "Journal", value: article.journal || "N/A", inline: true },
              { name: "Year", value: String(article.year || "N/A"), inline: true },
              {
                name: "PubMed",
                value: `[PMID ${article.pmid}](https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/)`,
                inline: true,
              },
            ],
            footer: "Auto-discovered by PedQuEST Publication Scanner",
          });
        } catch (e) {
          errors.push(`Failed to fetch PMID ${pmid}: ${e}`);
        }
      }
    } catch (e) {
      errors.push(`Search failed for ${memberName}: ${e}`);
    }
  }

  // Log the scan run
  if (supabase) {
    try {
      const { error: scanLogErr } = await supabase.from("publication_update_log").insert({
        action: "scan_completed",
        scanned_at: new Date().toISOString(),
        metadata: { scanned, newCount: newArticles.length, errorCount: errors.length },
      });
      if (scanLogErr) {
        errors.push(`scan_completed log insert failed: ${scanLogErr.message}`);
      }
    } catch (e) {
      errors.push(`scan_completed log threw: ${e}`);
    }
  }

  return NextResponse.json({
    scanned,
    newArticles: newArticles.map((a) => ({
      pmid: a.pmid,
      title: a.title,
      journal: a.journal,
      year: a.year,
      memberId: a.memberId,
    })),
    errors,
  });
}
