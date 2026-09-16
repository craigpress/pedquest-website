#!/usr/bin/env node
// Prune old Vercel deployments to keep Deployment Storage under the Hobby 10 GB cap.
//
// Keeps the newest KEEP_PRODUCTION production deployments and the newest
// KEEP_PREVIEW preview deployments; deletes the rest. Never deletes the
// deployment currently serving the production alias (Vercel refuses that, and
// we also skip it explicitly). Idempotent and safe to run on a schedule.
//
// Auth: set VERCEL_TOKEN (create at https://vercel.com/account/tokens). The
// script also reads a token from %USERPROFILE%\.vercel-prune-token if present,
// so the scheduled task does not have to carry it in its command line.
//
//   node scripts/prune-vercel-deployments.mjs            # prune
//   node scripts/prune-vercel-deployments.mjs --dry-run  # report only
//
// Registered as the weekly Windows task "PedQuEST-Vercel-Prune" (see
// scripts/register-vercel-prune-task.ps1).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEAM_ID = "team_6WS49eN6sADOTFN5nVA4iRQD";
const PROJECT = "pedquest-site";
const KEEP_PRODUCTION = 3; // current live + 2 rollbacks
const KEEP_PREVIEW = 2;
const DRY_RUN = process.argv.includes("--dry-run");

function token() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim();
  const f = path.join(os.homedir(), ".vercel-prune-token");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim();
  console.error(
    "No Vercel token. Set VERCEL_TOKEN, or write the token to " + f +
    "\nCreate one at https://vercel.com/account/tokens (scope: the craigpress team)."
  );
  process.exit(2);
}
const TOKEN = token();
const H = { Authorization: `Bearer ${TOKEN}` };

async function api(pathAndQuery, init = {}) {
  const url = `https://api.vercel.com${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}teamId=${TEAM_ID}`;
  const r = await fetch(url, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${pathAndQuery} -> ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function listAll() {
  const out = [];
  let until;
  for (let page = 0; page < 50; page++) {
    const q = `/v6/deployments?projectId=${PROJECT}&limit=100${until ? `&until=${until}` : ""}`;
    const { deployments, pagination } = await api(q);
    out.push(...deployments);
    if (!pagination?.next) break;
    until = pagination.next;
  }
  return out;
}

async function main() {
  const all = await listAll();
  all.sort((a, b) => b.created - a.created);
  const prod = all.filter((d) => d.target === "production");
  const preview = all.filter((d) => d.target !== "production");
  const keep = new Set([
    ...prod.slice(0, KEEP_PRODUCTION).map((d) => d.uid),
    ...preview.slice(0, KEEP_PREVIEW).map((d) => d.uid),
  ]);
  const toDelete = all.filter((d) => !keep.has(d.uid));
  console.log(
    `${all.length} deployments (${prod.length} production, ${preview.length} preview); ` +
    `keeping ${keep.size}, deleting ${toDelete.length}${DRY_RUN ? " [dry-run]" : ""}.`
  );
  let removed = 0, skipped = 0;
  for (const d of toDelete) {
    const label = `${d.url} (${d.target || "preview"}, ${new Date(d.created).toISOString().slice(0, 10)})`;
    if (DRY_RUN) { console.log("  would delete", label); continue; }
    try {
      await api(`/v13/deployments/${d.uid}`, { method: "DELETE" });
      removed++;
      console.log("  deleted", label);
    } catch (e) {
      // Vercel refuses to delete the deployment behind the current production
      // alias; that is exactly what we want to keep, so treat it as a skip.
      skipped++;
      console.log("  skipped", label, "-", String(e).split("\n")[0].slice(0, 80));
    }
  }
  console.log(DRY_RUN ? "Dry run complete." : `Done: ${removed} deleted, ${skipped} skipped.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
