// One-off: apply the deterministic option shuffle (src/lib/qbank/question.ts)
// to items already in the database, so the correct answer stops sitting at
// position A. Seeded by qbank_id, so this is idempotent.
import { loadEnvLocal, supabaseCredentials } from "./_env";
import { createClient } from "@supabase/supabase-js";
import { shuffleOptions } from "../src/lib/qbank/question";

loadEnvLocal();
const { url, key } = supabaseCredentials();
const sb = createClient(url, key, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const { data: cases, error } = await sb
  .from("eeg_cases").select("id,qbank_id,question_type").eq("question_type", "multiple_choice");
if (error) throw new Error(error.message);

let moved = 0, unchanged = 0;
const before: number[] = [], after: number[] = [];
for (const c of cases ?? []) {
  const { data: opts } = await sb
    .from("eeg_case_options").select("id,sort_order,is_correct").eq("case_id", (c as any).id).order("sort_order");
  if (!opts || opts.length < 2) continue;
  const seedId = (c as any).qbank_id || (c as any).id;
  const order = shuffleOptions(seedId, opts as any[]);
  before.push((opts as any[]).findIndex((o) => o.is_correct));
  after.push(order.findIndex((o: any) => o.is_correct));
  const changed = order.some((o: any, i: number) => o.sort_order !== i);
  if (!changed) { unchanged++; continue; }
  moved++;
  if (apply) {
    // two passes: park out of range first so the (case_id, sort_order) order is never ambiguous
    for (let i = 0; i < order.length; i++) {
      await sb.from("eeg_case_options").update({ sort_order: 100 + i }).eq("id", (order[i] as any).id);
    }
    for (let i = 0; i < order.length; i++) {
      await sb.from("eeg_case_options").update({ sort_order: i }).eq("id", (order[i] as any).id);
    }
  }
}
const hist = (a: number[]) => [0,1,2,3,4].map((k) => `${String.fromCharCode(65+k)}:${a.filter((x) => x===k).length}`).join(" ");
console.log(`items: ${cases?.length ?? 0}  reordered: ${moved}  already ok: ${unchanged}`);
console.log(`correct-answer position BEFORE  ${hist(before)}`);
console.log(`correct-answer position AFTER   ${hist(after)}`);
console.log(apply ? "APPLIED" : "dry run — pass --apply to write");
