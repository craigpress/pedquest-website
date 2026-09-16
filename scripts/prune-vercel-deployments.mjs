#!/usr/bin/env node
// Prune old Vercel deployments to keep Deployment Storage under the Hobby 10 GB
// cap. Keeps the newest KEEP_PRODUCTION production deployments and the newest
// KEEP_PREVIEW preview deployments; deletes the rest.
//
// Auth: NONE needed. It shells out to the `vercel` CLI, which is already logged
// in on this machine (the same login your `vercel ...` terminal commands use),
// so there is no token to create or store. `--safe` also makes the CLI refuse
// to delete anything aliased to production.
//
//   node scripts/prune-vercel-deployments.mjs            # prune
//   node scripts/prune-vercel-deployments.mjs --dry-run  # report only
//
// Registered as the weekly Windows task "PedQuEST-Vercel-Prune" (see
// scripts/register-vercel-prune-task.ps1). `vercel ls` shows the most recent
// deployments newest-first; a weekly run over that page is enough to stop
// buildup once the historical backlog is cleared.

import { execFileSync } from "node:child_process";

const PROJECT = "pedquest-site";
const KEEP_PRODUCTION = 3; // current live + 2 rollbacks
const KEEP_PREVIEW = 2;
const DRY_RUN = process.argv.includes("--dry-run");
const VERCEL = process.platform === "win32" ? "vercel.cmd" : "vercel";

function vercel(args) {
  // shell:true is required on Windows, where recent Node refuses to spawn a
  // .cmd shim directly (EINVAL). Our args are deployment URLs and flags with no
  // shell metacharacters, so quoting each one keeps this safe.
  const quoted = args.map((a) => (/^[\w.:/@=-]+$/.test(a) ? a : `"${a}"`));
  return execFileSync(VERCEL, quoted, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });
}

// Like vercel(), but merges stderr into stdout so we can read the styled table
// that `vercel ls` prints on stderr.
function vercelCombined(args) {
  const quoted = args.map((a) => (/^[\w.:/@=-]+$/.test(a) ? a : `"${a}"`));
  return execFileSync(VERCEL, [...quoted, "2>&1"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
    shell: true,
  });
}

function listDeployments() {
  // The styled table (Age / URL / Status / Environment / …) is printed on
  // stderr, newest-first; stdout carries only a bare URL list with no columns.
  // So we merge both streams and keep only the table rows — a line that has
  // BOTH a deployment URL AND an Environment word. That naturally skips the
  // bare-URL list, the headers, and the progress lines.
  const raw = vercelCombined(["ls", PROJECT, "--yes"]);
  const rows = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/https:\/\/[a-z0-9-]+-craigpress\.vercel\.app/);
    if (!m || !/\b(Production|Preview)\b/.test(line)) continue;
    rows.push({
      url: m[0],
      env: /\bProduction\b/.test(line) ? "production" : "preview",
      errored: /\bError\b/.test(line),
    });
  }
  return rows;
}

function main() {
  if (!DRY_RUN) {
    try { vercel(["whoami"]); }
    catch { console.error("vercel CLI is not logged in — run `vercel login` once in a terminal."); process.exit(2); }
  }
  const rows = listDeployments();
  let prod = 0, prev = 0;
  const toDelete = [];
  for (const r of rows) {
    // Errored builds are never useful rollback targets — always prune them and
    // don't let them consume a keep slot.
    if (r.errored) { toDelete.push(r); continue; }
    const keep = r.env === "production" ? ++prod <= KEEP_PRODUCTION : ++prev <= KEEP_PREVIEW;
    if (!keep) toDelete.push(r);
  }
  console.log(
    `${rows.length} deployments listed; keeping newest ${KEEP_PRODUCTION} production + ` +
    `${KEEP_PREVIEW} preview (Ready only), deleting ${toDelete.length}${DRY_RUN ? " [dry-run]" : ""}.`,
  );
  let removed = 0, skipped = 0;
  for (const r of toDelete) {
    if (DRY_RUN) { console.log("  would delete", r.url, `(${r.env})`); continue; }
    try {
      vercel(["remove", r.url, "--yes", "--safe"]);
      removed++;
      console.log("  deleted", r.url);
    } catch (e) {
      // `--safe` refuses a deployment aliased to production — treat as a skip.
      skipped++;
      console.log("  skipped", r.url, "-", String(e.stderr || e.message || e).split("\n")[0].slice(0, 80));
    }
  }
  console.log(DRY_RUN ? "Dry run complete." : `Done: ${removed} deleted, ${skipped} skipped.`);
}

try { main(); }
catch (e) { console.error(String(e.stderr || e.message || e)); process.exit(1); }
