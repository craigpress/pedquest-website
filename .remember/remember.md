# Handoff

## State
Shipped async AI image generation for the qEEG "Case of the Day" to prod (commit 2cf37b8, Vercel build Ready). Admin clicks "✦ Generate (AI)" → enqueues an `eeg_case_image_jobs` row → a homelab worker on moltbot (`case-image-worker.service`) generates via `cipher-openclaw`/$imagegen, uploads to the Supabase `eeg-cases` bucket, marks the job done → admin UI polls it in and auto-sets `ai-original` license. Migrations 20260715 (license columns + `caseImagePublishBlock` publish gate) and 20260716 (job queue) applied to Supabase. Verified end-to-end (real EEG PNG landed in storage). Also fixed the OpenClaw bridge (`delta.images` via `/media` URLs) + added NPM `/media` route on ai.presshome.net.

## Next
1. Optional: log into pedquest.org/admin/cases and click Generate (AI) to confirm the live UI flow end-to-end (so far verified via direct job insert + worker, not through the deployed button).
2. Consider Vercel Pro later — Hobby's 60s function cap is the whole reason gen is async; Pro would allow a synchronous fallback.

## Context
- Homelab worker is gitignored (`homelab/`) — holds internal IPs + the Supabase service-role key (root-600 on moltbot). Never commit it to the public repo.
- OpenWebUI strips `delta.images` on relay (and rejects SSE lines >131072 bytes), so the bridge uses short `/media/` URLs and the async worker calls the bridge on localhost. Memory: `project_case_image_gen`.
- `vercel env pull` on Windows writes CRLF + escaped `\n`; systemd turned `supabase.co\n`→`supabase.con` → TLS failure. Debug via `/proc/<pid>/environ` + `od -c`. Memory: `reference_vercel_env_pull_crlf`.
