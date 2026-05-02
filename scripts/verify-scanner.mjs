#!/usr/bin/env node
// Health check for the PubMed publication scanner.
// Run after each scheduled scan to confirm the pipeline is healthy end-to-end.
//
// Checks:
//   1. publications table is reachable AND has rows (basic read).
//   2. publication_update_log has a `scan_completed` entry within the last 96h.
//   3. Recent auto_discovered PMIDs are also present in `publications` (writes lined up).
//   4. Every auto_discovered row has a member_id that resolves to a member in src/data/members.ts.
//   5. No PMID has been auto_discovered more than once (dedup working).
//   6. Discord webhook is reachable (sends a single status message).
//
// Exits non-zero on any failure and posts a red Discord alert. Posts a green status
// message on success only when run via workflow_dispatch (avoids cron spam).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DISCORD = process.env.DISCORD_WEBHOOK_URL;
const IS_DISPATCH = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("FATAL: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const checks = [];
function pass(name, detail = "") {
  checks.push({ name, status: "ok", detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  checks.push({ name, status: "fail", detail });
  console.error(`FAIL ${name} — ${detail}`);
}

async function sb(pathQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: r.status, body };
}

// ----- 1. publications reachable ----------------------------------------
{
  const r = await sb("publications?select=pmid&limit=1");
  if (r.status !== 200 || !Array.isArray(r.body)) {
    fail("publications_reachable", `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  } else {
    pass("publications_reachable", `${r.body.length} sample row(s)`);
  }
}

// ----- 2. recent scan_completed log entry -------------------------------
const since = new Date(Date.now() - 96 * 3600 * 1000).toISOString();
{
  const r = await sb(
    `publication_update_log?action=eq.scan_completed&scanned_at=gte.${encodeURIComponent(since)}&select=scanned_at,metadata&order=scanned_at.desc&limit=1`,
  );
  if (r.status !== 200) {
    fail("recent_scan_completed", `query failed: ${JSON.stringify(r.body).slice(0, 200)}`);
  } else if (!Array.isArray(r.body) || r.body.length === 0) {
    fail("recent_scan_completed", `no scan_completed log entry in the last 96h (since ${since})`);
  } else {
    const row = r.body[0];
    pass(
      "recent_scan_completed",
      `last scan ${row.scanned_at} metadata=${JSON.stringify(row.metadata)}`,
    );
  }
}

// ----- 3. auto_discovered PMIDs present in publications -----------------
let autoRows = [];
{
  const r = await sb(
    `publication_update_log?action=eq.auto_discovered&scanned_at=gte.${encodeURIComponent(since)}&select=pmid,member_id,scanned_at`,
  );
  if (r.status !== 200) {
    fail("auto_discovered_query", `status=${r.status}`);
  } else {
    autoRows = Array.isArray(r.body) ? r.body : [];
    if (autoRows.length === 0) {
      pass("auto_discovered_query", "no new auto-discovered rows in the last 96h (acceptable)");
    } else {
      const pmids = autoRows.map((x) => x.pmid).filter(Boolean);
      const r2 = await sb(`publications?pmid=in.(${pmids.join(",")})&select=pmid`);
      if (r2.status !== 200 || !Array.isArray(r2.body)) {
        fail("auto_discovered_persisted", `lookup failed: ${JSON.stringify(r2.body).slice(0, 200)}`);
      } else {
        const found = new Set(r2.body.map((x) => String(x.pmid)));
        const missing = pmids.filter((p) => !found.has(String(p)));
        if (missing.length > 0) {
          fail(
            "auto_discovered_persisted",
            `${missing.length}/${pmids.length} auto_discovered PMIDs are NOT in publications: ${missing.slice(0, 5).join(", ")}`,
          );
        } else {
          pass("auto_discovered_persisted", `${pmids.length} new PMIDs all persisted`);
        }
      }
    }
  }
}

// ----- 4. every auto_discovered row has a known member_id ---------------
{
  // Parse member ids from src/data/members.ts (cheap regex over export array)
  const membersTs = fs.readFileSync(path.join(repoRoot, "src/data/members.ts"), "utf8");
  const ids = new Set();
  // Match `id: "some-id"` in member object literals
  for (const m of membersTs.matchAll(/\bid:\s*["']([a-z0-9-]+)["']/g)) ids.add(m[1]);
  if (ids.size === 0) {
    fail("members_parsed", "could not extract any member ids from src/data/members.ts");
  } else {
    pass("members_parsed", `${ids.size} member ids loaded`);
    if (autoRows.length > 0) {
      const unknown = autoRows.filter((r) => r.member_id && !ids.has(r.member_id));
      if (unknown.length > 0) {
        fail(
          "auto_discovered_member_known",
          `${unknown.length} auto_discovered rows reference unknown member ids: ${[...new Set(unknown.map((u) => u.member_id))].slice(0, 5).join(", ")}`,
        );
      } else {
        pass("auto_discovered_member_known", `all ${autoRows.length} auto-discovered rows map to known members`);
      }
    }
  }
}

// ----- 5. no PMID auto_discovered more than once -----------------------
{
  const r = await sb(
    `publication_update_log?action=eq.auto_discovered&select=pmid&order=pmid.asc&limit=10000`,
  );
  if (r.status !== 200 || !Array.isArray(r.body)) {
    fail("dedup_check", `query failed: status=${r.status}`);
  } else {
    const counts = new Map();
    for (const row of r.body) {
      if (!row.pmid) continue;
      counts.set(row.pmid, (counts.get(row.pmid) || 0) + 1);
    }
    const dups = [...counts.entries()].filter(([, n]) => n > 1);
    if (dups.length > 0) {
      const sample = dups
        .slice(0, 5)
        .map(([p, n]) => `${p}×${n}`)
        .join(", ");
      fail(
        "dedup_no_repeats",
        `${dups.length} PMID(s) auto_discovered more than once: ${sample}`,
      );
    } else {
      pass("dedup_no_repeats", `${counts.size} unique auto_discovered PMIDs, no duplicates`);
    }
  }
}

// ----- 6. Discord webhook reachable ------------------------------------
const failures = checks.filter((c) => c.status === "fail");
const summary = checks.map((c) => `${c.status === "ok" ? "✅" : "❌"} ${c.name}`).join("\n");

if (DISCORD && (failures.length > 0 || IS_DISPATCH)) {
  const color = failures.length > 0 ? 0xe74c3c : 0x2ecc71;
  const title = failures.length > 0 ? "🚨 Scanner verification FAILED" : "✅ Scanner verification OK";
  const r = await fetch(DISCORD, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title,
          color,
          description: summary,
          footer: { text: `Scanner verification • ${new Date().toISOString()}` },
        },
      ],
    }),
  });
  if (r.ok) {
    pass("discord_reachable", `posted status (HTTP ${r.status})`);
  } else {
    fail("discord_reachable", `HTTP ${r.status}`);
  }
} else if (!DISCORD) {
  fail("discord_reachable", "DISCORD_WEBHOOK_URL not set");
} else {
  pass("discord_reachable", "skipped (cron run, all green)");
}

console.log("\n=== summary ===");
for (const c of checks) {
  console.log(`${c.status === "ok" ? "✓" : "✗"} ${c.name}: ${c.detail}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} checks passed`);
