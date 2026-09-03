// Read content/qbank/BLUEPRINT.md and work out where the bank is short.
//
// The blueprint's markdown table is the plan of record (domain, target count,
// writer, scope). The generator picks the domain with the largest shortfall and
// draws a topic from that domain's scope text, so coverage converges on the
// plan instead of drifting toward whatever the model finds easy.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface BlueprintDomain {
  code: string;
  name: string;
  target: number;
  writer: string;
  /** the "Scope (learning objectives)" cell, split into topic candidates */
  scope: string[];
}

export interface CoverageGap extends BlueprintDomain {
  have: number;
  short: number;
}

const BLUEPRINT_PATH = join(process.cwd(), "content", "qbank", "BLUEPRINT.md");

/**
 * Parse the domain table. Rows look like:
 * | `foundations` | How qEEG trends are ... | 10 | A | FFT spectrogram/CDSA ...; aEEG ...; |
 * Returns [] when the file is missing rather than throwing — the caller
 * reports "blueprint unavailable" instead of failing a cron run outright.
 */
export async function loadBlueprint(path = BLUEPRINT_PATH): Promise<BlueprintDomain[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  const domains: BlueprintDomain[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const code = cells[0].replace(/`/g, "").trim();
    if (!/^[a-z_]+$/.test(code)) continue;             // skips the header and the |---| rule
    const target = parseInt(cells[2], 10);
    if (!Number.isFinite(target)) continue;
    domains.push({
      code,
      name: cells[1],
      target,
      writer: cells[3].replace(/\s*\(.*?\)\s*/g, " ").trim(),
      scope: cells[4]
        .split(";")
        .map((s) => s.replace(/\.$/, "").trim())
        .filter((s) => s.length > 12),
    });
  }
  return domains;
}

/**
 * Join the blueprint targets to what the bank actually holds.
 * `counts` is domain -> number of items that count toward the target
 * (anything not archived/rejected — see qbankDomainCounts below).
 * Sorted by the largest shortfall first.
 */
export function coverageGaps(
  blueprint: BlueprintDomain[],
  counts: Record<string, number>,
): CoverageGap[] {
  return blueprint
    .map((d) => {
      const have = counts[d.code] ?? 0;
      return { ...d, have, short: Math.max(0, d.target - have) };
    })
    .sort((a, b) => b.short - a.short || a.code.localeCompare(b.code));
}

/**
 * Pick the next N (domain, topic) pairs to draft, spreading across the
 * short domains rather than piling every draft into the worst one.
 * `existingTopics` are topics already drafted or in the bank; they are skipped
 * so a repeated cron run does not keep proposing the same objective.
 */
export function planTopics(
  gaps: CoverageGap[],
  n: number,
  existingTopics: string[] = [],
): { domain: string; topic: string; writer: string }[] {
  const seen = new Set(existingTopics.map((t) => t.toLowerCase().trim()));
  const short = gaps.filter((g) => g.short > 0 && g.scope.length > 0);
  const out: { domain: string; topic: string; writer: string }[] = [];
  // round-robin across domains, deepest shortfall first
  for (let round = 0; out.length < n && round < 8; round++) {
    let progressed = false;
    for (const g of short) {
      if (out.length >= n) break;
      const topic = g.scope.find((s) => !seen.has(s.toLowerCase().trim()));
      if (!topic) continue;
      seen.add(topic.toLowerCase().trim());
      out.push({ domain: g.code, topic, writer: g.writer });
      progressed = true;
    }
    if (!progressed) break;
  }
  return out;
}
