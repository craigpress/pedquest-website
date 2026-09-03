/**
 * Run the question-bank generation pipeline from the command line.
 *
 *   npm run qbank:generate -- --dry-run              # print one draft, write nothing
 *   npm run qbank:generate -- --dry-run --count 2
 *   npm run qbank:generate -- --dry-run --domain seizure_detection --topic "cyclic seizures"
 *   npm run qbank:generate -- --count 3              # write drafts + render jobs
 *
 * --dry-run needs no Supabase credentials: blueprint gaps come back empty, the
 * topic is taken from --topic (or the blueprint's first gap), and the draft is
 * printed instead of stored. With no LLM provider configured the mock provider
 * answers and the run reports that no item could be produced — the prompt
 * assembly and the critic still execute.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import { generateDrafts } from "../src/lib/qbank/generate";
import { describeProvider } from "../src/lib/qbank/draft";

const DRY = process.argv.includes("--dry-run");
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

async function main() {
  loadEnvLocal();

  const count = Number(arg("count") ?? "1") || 1;
  const domain = arg("domain");
  const topic = arg("topic");

  let supabase: SupabaseClient | null = null;
  try {
    const { url, key } = supabaseCredentials();
    supabase = createClient(url, key, { auth: { persistSession: false } });
  } catch (e) {
    if (!DRY) {
      console.error((e as Error).message);
      process.exit(1);
    }
    console.log("No Supabase credentials — running fully offline (dry run).");
  }

  const { provider, model } = describeProvider();
  console.log(`provider=${provider} model=${model} count=${count}${DRY ? " (dry run)" : ""}`);
  if (provider === "mock") {
    console.log(
      "WARNING: no LLM provider configured. Set OPENWEBUI_BASE_URL/OPENWEBUI_API_KEY/OPENWEBUI_MODEL\n" +
      "or ANTHROPIC_API_KEY. The mock provider exercises retrieval, prompt assembly and the\n" +
      "critic, but cannot produce an item.",
    );
  }

  const summary = await generateDrafts(supabase, {
    count,
    dryRun: DRY,
    budgetMs: Number(process.env.QBANK_GENERATE_BUDGET_MS ?? 240000),
    timeoutMs: Number(process.env.QBANK_LLM_TIMEOUT_MS ?? 120000),
    ...(domain && topic ? { domain, topic } : {}),
  });

  console.log("");
  console.log(`planned: ${summary.planned.map((p) => `${p.domain}/${p.topic.slice(0, 48)}`).join(" | ") || "(nothing)"}`);
  for (const note of summary.notes) console.log(`note: ${note}`);

  for (const r of summary.results) {
    console.log("");
    console.log(`── ${r.id}  ${r.status}${r.caseStatus ? ` (${r.caseStatus})` : ""}`);
    console.log(`   domain: ${r.domain}`);
    console.log(`   topic:  ${r.topic}`);
    if (r.pmids.length) console.log(`   pmids:  ${r.pmids.join(", ")}`);
    if (r.critic) {
      console.log(`   critic: score ${r.critic.score}, ${r.critic.pass ? "pass" : "FAIL"}`);
      for (const f of r.critic.findings) {
        console.log(`     [${f.severity}] ${f.check}: ${f.detail}`);
      }
      if (r.critic.coverTest) {
        console.log(`     cover test: ${r.critic.coverTest.answerable ? "answerable" : "NOT answerable"} — ${r.critic.coverTest.note}`);
      }
    }
    if (r.error) console.log(`   error:  ${r.error}`);
    if (r.question) {
      console.log("   ---- draft ----");
      console.log(JSON.stringify(r.question, null, 2).split("\n").map((l) => `   ${l}`).join("\n"));
    }
    if (r.caseId) console.log(`   case:   ${r.caseId} (render job enqueued)`);
  }

  console.log("");
  const drafted = summary.results.filter((r) => r.status === "drafted").length;
  console.log(`${drafted} drafted, ${summary.results.length - drafted} failed.`);
  if (DRY) console.log("DRY RUN — nothing was written.");
}

main().catch((e) => {
  // process.exitCode, not process.exit(): see the note in qbank-import.ts.
  console.error(e);
  process.exitCode = 1;
});
