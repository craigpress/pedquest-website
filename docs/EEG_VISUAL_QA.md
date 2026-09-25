# Generation visual QA and linked reference

Implemented on `eeg-visual-qa`, based on production `b1091c6`. Not deployed; migration and provider configuration are prerequisites.

## Behavior

- Question-bank worker reviews the generated image. FFT/aEEG-only renders additionally create three raw15s windows using the exact source object used for the trend render. Composite images already contain a raw view. Main PNG bytes are unchanged by evidence generation (regression tested).
- Lab export worker computes the existing viewer sidecar, reads raw windows from the exported EDF/LAY, and renders those samples plus the **actual sidecar arrays**. It stores QA PNGs alongside the export. QA images use a shared left/right spectrogram scale. Up to five raw windows cover start, midpoint,90% and measured bilateral total-power extrema; overlapping windows are omitted. Numbered shading links raw windows to trends, and raw pages include50µV calibration. This is power-directed sampling, not exhaustive event detection. A screen can only pass within its documented coverage.
- CLI `render`, `render-all`, and `preview` record image-only reviews when writing sidecars. Existing skipped images are not retroactively reviewed. CLI reports use exclusive local audit-file reservations; missing paired evidence stays flagged.
- The database reserves one attempt before provider I/O. Unique generation keys prevent duplicate calls across worker retries/restarts; changed artifacts invalidate prior results. No QA code re-enqueues generation. The automatic budget is **one** attempt, within the requested maximum of three. Suggested prompt refinements go to the editor; automatic prompt rewriting is deliberately absent. Manual new candidates get new generation IDs.
- Invalid/unavailable model responses, required missing evidence, and major findings cannot pass. Model output never changes approval/publication decisions. Interrupted reservations remain visible as incomplete; no automatic takeover spends another attempt.
- `/admin/eeg-qa` lists latest100 unresolved/incomplete screens with review links. Editor-only API; service-role-only audit table. Reports retain prompt/version/model, source/spec context, hashes and findings. Lab QA images remain in the private store and receive10-minute signed links only through the editor-only QA route. Question-bank paired evidence has links in the report.

## References and concept tags

`/education/eeg-reference` and stable feature permalinks expose77 entries: existing47 draft feature contracts plus30 glossary/context entries. ACNS2021 critical-care terminology, neonatal terminology2013, neonatal monitoring indications2025, ILAE2025 and neonatal2021 classifications, IFCN2017 glossary and AES sources are distinguished. References remain explicitly editorial drafts; copied source PDFs and local/private source paths are not published.

Question-bank and Lab review screens derive concept tags from text and existing tags, distinguish explicit/mentioned/uncertain/negated terms, and link definitions. Editors can confirm or dismiss a match; corrections persist separately and are not overwritten by subsequent matching. This is deterministic phrase matching, not clinical NLP or visual feature detection; ambiguous phrasing requires editorial review.

## Deployment order

1. Migration `supabase/migrations/20260925000001_eeg_visual_qa.sql` was applied September25 through the existing Management API workflow. Both tables have RLS, no anon/authenticated direct reads, and service-role insertion. Receipt: outer review package `migration-receipt.json`.
2. Configure worker-side `EEG_QA_BASE_URL=https://bifrost.presshome.net/v1`, `EEG_QA_API_KEY`, `EEG_QA_MODEL=codex/gpt-6-sol`. Craig selected cloud inference; this existing Codex CLI cloud route passed chart and EEG checks through Bifrost, plus the actual QA contract on a raw page (33.73s) and four-image raw/trend packet (45.82s), on September25. The earlier empty listing came from the intentionally MCP-only Codex key, not an empty gateway. Benchmark access used the existing OpenWebUI inference key with `x-bf-mcp-include-clients: none`; runtime should use a scoped inference credential. Never expose credentials through `NEXT_PUBLIC_*`. Provider timeout120s, image maximum8, output limit3000 tokens. Website/fleet configuration remains undeployed.
3. Build/copy the trend-sidecar bundle with the worker code to both existing fleets. Deploy website branch using the normal Git/Vercel workflow. Do not merge candidate renderer109/110 or overwrite canonical uncommitted0.4.5 display work as part of deployment.
4. Run one synthetic job through each live path; inspect its saved report, retry once to prove no duplicate call, and check editor/member access and saved tag corrections. Only then call runtime QA live-accepted.

The older AI bitmap `eeg_case_image_jobs` route points to an external legacy worker not present in this repository. That worker's QA integration is not implemented here; verify whether it is still used before re-enabling that path. Third-party Persyst outputs are not visually reviewed by this hook; the reviewed trends are the website viewer's calculated trends.

## Evidence and checks

Batch review artifacts live outside Git at `../research/eeg-atlas/visual-qa-20260925/`: `REVIEW.md`,95-row matrix, original hash inventory, before/after HTML gallery,14 round2 candidates and one round3 candidate. Newest renderer provenance is `c50e282`; B5 refinements retain hashes of the canonical0.4.5 source files. No human decisions changed. External figure comparison is complete only for the ACNS examples documented in that report; access-limited normal-variant/sedation comparisons remain flagged.

Tests cover persisted attempt reservation/retry, concurrent duplicate entry, provider failure, changed artifacts, missing evidence, report validation, CLI reservation reuse, unchanged primary image bytes, time-major sidecar plotting, malformed sidecars, source IDs, synonyms and negation. Existing known-frequency/power and auxiliary-channel isolation tests also pass. Production build uses `next build --webpack`: Turbopack rejects this isolated worktree's external node_modules junction. Browser search and a feature detail/source link were inspected locally. Authenticated database/provider and production deployment acceptance remain pending.

Final verification: Python renderer suite169 passed,1 skipped; TypeScript trend/reference tests8 passed; API authentication smoke1 passed (covers all3 new handler entry points); focused lint and TypeScript passed. Two old worker test doubles initially failed after the signature change; updated fixtures preserve their version-attachment assertions and the final full suite passes.

Code review identified a distinction worth preserving: viewer engine3 suppression uses `<6µV` peak-to-peak (twice the3µV threshold constant), while the Python renderer's default is5µV peak-to-peak. QA records the viewer rule and glossary explains the difference; no clinical threshold or algorithm was silently changed.
