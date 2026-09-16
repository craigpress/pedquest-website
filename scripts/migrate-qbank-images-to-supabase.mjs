#!/usr/bin/env node
// Move the rendered question-bank PNGs out of the Vercel deployment and into a
// public Supabase Storage bucket, so ~35 MB of images stop riding inside every
// build (Hobby Deployment-Storage cap).
//
// This is the optional structural cut. With the weekly prune task keeping only
// a few deployments, it is no longer required — run it only if you want each
// build slimmer as the bank grows.
//
// Steps this script does (idempotent, additive — it never deletes local files):
//   1. create/confirm a PUBLIC bucket `qbank-images`
//   2. upload every public/images/qbank/*.png (upsert)
//   3. print the public base URL to set as NEXT_PUBLIC_QBANK_IMAGE_BASE
//
// After running and setting the env var in Vercel, verify the live qbank images
// load from Supabase, then `git rm -r public/images/qbank` and update the
// renderer/deploy pipeline (tools/eeg-render worker + verify_sidecars.py) to
// upload new renders to the bucket instead of writing public/images/qbank.
//
//   node scripts/migrate-qbank-images-to-supabase.mjs [--dry-run]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (both in .env.local).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const BUCKET = "qbank-images";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "public", "images", "qbank");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (they are in .env.local).");
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".png"));
  const bytes = files.reduce((s, f) => s + fs.statSync(path.join(DIR, f)).size, 0);
  console.log(`${files.length} PNGs, ${(bytes / 1e6).toFixed(1)} MB, bucket "${BUCKET}"${DRY ? " [dry-run]" : ""}`);

  if (!DRY) {
    const { data: buckets } = await sb.storage.listBuckets();
    if (!buckets?.some((b) => b.name === BUCKET)) {
      const { error } = await sb.storage.createBucket(BUCKET, { public: true });
      if (error && !/already exists/i.test(error.message)) throw error;
      console.log("  created public bucket", BUCKET);
    }
  }

  let done = 0;
  for (const f of files) {
    if (DRY) { console.log("  would upload", f); continue; }
    const body = fs.readFileSync(path.join(DIR, f));
    const { error } = await sb.storage.from(BUCKET).upload(f, body, {
      contentType: "image/png", upsert: true, cacheControl: "31536000",
    });
    if (error) throw new Error(`${f}: ${error.message}`);
    if (++done % 10 === 0) console.log(`  uploaded ${done}/${files.length}`);
  }

  const base = `${url.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}`;
  console.log(DRY ? "\nDry run complete." : `\nUploaded ${done} files.`);
  console.log("Set this in Vercel (Production + Preview) and redeploy:");
  console.log(`  NEXT_PUBLIC_QBANK_IMAGE_BASE=${base}`);
  console.log(`Sample: ${base}/${files[0] ?? "PQ-A-001.png"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
