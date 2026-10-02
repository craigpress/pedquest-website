# Production-readiness code review — 2026-10-02

Base `origin/main` d984774. Scope: Next.js app (`src/`), Supabase migrations and storage policies, scripts, worker tools and renderer hygiene (`tools/`). Files under concurrent edit by other engineers (`src/lib/lab/scoring.ts`, `src/lib/eeg/annotations.ts`, `src/lib/lab/key-kinds.ts`, lab results pages/routes, `AnnotationPanel.tsx`, `src/app/admin/eeg-lab/gallery/*`, `Navbar.tsx`, public list pages and home) were read but not modified. Findings on them are marked **(owned)**.

Prior reviews (`EEG_CODE_PERFORMANCE_REVIEW_20261001.md`, `EEG_RELEASE_REVIEW_20261001.md`): their code items are resolved. These operational items are still open: post-rollout external performance and authenticated-gallery verification, the coordinated renderer 0.5.4 rollout and sidecar refresh, and B023's weaker raw-inset confirmation. Mobile lab LCP was 3.9 s. Finding P1 below is a likely contributor.

## Verification

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | pass | pass |
| `eslint .` | 14 errors, 58 warnings | 0 errors, 44 warnings (30 are `set-state-in-effect`, set to warn on purpose; the rest are in owned files or the orphaned admin citation feature, A4) |
| Unit tests (`npm test`, new script) | 80/82 without the flag; the 2 `mock.module` files need `--experimental-test-module-mocks` | 93/93 (adds 3 switch-user tests and 1 secret-whitespace assertion) |
| `next build --webpack` | — | pass, 149 pages |
| Renderer `pytest` (847) | see commit message | no renderer code changed |

## Findings

Severity: **H** high, **M** medium, **L** low. "Fixed" means the change is on this branch. "Rec" means the change is recommended and needs an owner.

### Security / authorization

| # | Sev | Location | Finding | Status | Rationale |
|---|---|---|---|---|---|
| S1 | H | `src/app/api/admin/switch-user/route.ts:47` | An editor could switch into any `is_test` row, including a test row an admin had promoted to `editor`/`admin`. That gave the editor a full session at a higher role than their own. The `is_test` gate was the only check. | **Fixed**: the target role must be no higher than the caller's role (`hasRole(auth.role, targetRole)`). Tests added in `route.test.ts`. | The route mints a full session token. Raising privilege through a demo feature is never intended. |
| S2 | H | `supabase/schema.sql:358-368` (`member-files` bucket) | Storage policies let any authenticated user INSERT or UPDATE any object in the public `member-files` bucket. The "own files" UPDATE policy has no owner predicate. Any signed-in member can overwrite another member's photo (`photos/<id>.ext`) or CV, or host arbitrary files on the project storage domain. | Rec: scope INSERT/UPDATE to the owner, e.g. `(storage.foldername(name))[2] = <caller's member id>` or `owner = auth.uid()`, or route uploads through an API that checks identity. First verify the live policies. This file may not match production. | Defacement and file hosting, open to any account holder. |
| S3 | M | `src/app/profile/page.tsx:274`, `schema.sql:354` | Member CVs upload to a **public** bucket at a guessable path (`cvs/<member-id>/<filename>`). | Rec: use a private bucket with signed reads, or confirm CVs are meant to be public. | Privacy. |
| S4 | M | `src/app/api/auth/authentik-callback/route.ts:58-67` | The ID token is decoded without checks on signature, `nonce` or `email_verified`. A direct back-channel TLS token exchange is allowed by OIDC, so the missing signature check is acceptable. The real risk: if Authentik ever allows self-enrollment or user-editable email, a user who sets an editor's email gets that editor's PedQuEST session. | Rec: require `email_verified === true`, verify the nonce against the `auth_nonce` cookie, and confirm Authentik enrollment is closed. | The whole bridge trusts the email Authentik reports. |
| S5 | M | `src/app/api/auth/authentik-callback/route.ts:76` | `listUsers()` without paging returns only the first 50 users. After that, existing users were "not found", `createUser` failed silently, and `user_roles.user_id` was never backfilled from this path. The lookup was also case-sensitive. | **Fixed**: uses the new paged, case-insensitive `findAuthUserIdByEmail` (`src/lib/roles-server.ts`). | This was a correctness bug. Login still worked through `generateLink`. |
| S6 | M | `src/app/api/parse-cv/route.ts:350`, `src/app/api/pubmed/route.ts`, `src/app/api/abstract-search/route.ts` | These admin-only tools are unauthenticated public endpoints: a CPU-bound regex parser with no body-size cap, and two open NCBI proxies. | `pubmed`: **Fixed** by validating `pmid` as numeric; it was interpolated unencoded into the E-utilities URL. Rest: Rec, gate all three with `requireAdmin`; the callers in `src/app/admin/page.tsx` and `CVImporter.tsx` must then send the Bearer header. | Abuse surface and NCBI rate-limit exposure. |
| S7 | M | `next.config.ts` (CSP `connect-src`) | The viewer fetches signed recordings directly from the homelab store (`EEG_LAB_BASE_URL`, eeglab.presshome.net). That host is missing from `connect-src`. With `CSP_ENFORCE=1`, the production lab viewer would break. The current policy is report-only, so only reports are emitted today. | Rec: add the store origin before enforcing CSP. | Prevents an outage when CSP is enforced. |
| S8 | M | `backups/2026-04-15/*.json` (tracked in git) | The April database export is committed, including `members.json` with 65 names and emails. The contact, application and sponsor tables are empty in this export. | Rec: `git rm --cached backups/` and add `/backups/` to `.gitignore`. Decide whether to rewrite history. | Personal data in the repo. Future `npm run backup` outputs land in the same folder. |
| S9 | L | `src/app/api/admin/lab/jobs/[id]/annotations/route.ts:51` | `?all=1` lets any teacher read every user's marks, with display names, on any published recording, not only marks from learners in their own courses. | Rec: limit to course members, or confirm this is intended. | Least privilege for learner data. |
| S10 | L | `src/app/api/admin/lab/jobs/[id]/annotations/[annotationId]/route.ts:42-44` | PATCH does not re-check recording visibility. If the job row is missing, `duration_s` falls back to `Infinity`, which disables the bounds check. | Rec: reuse `loadJob` + `canSeeRecording` and return 404 when the job is missing. | Consistent with POST. |
| S11 | L | `src/app/api/admin/cases/upload/route.ts:14` | Allows `image/svg+xml` into the public `eeg-cases` bucket. The 8 MB limit cannot be reached because Vercel caps request bodies at 4.5 MB. | Rec: allowlist png/jpeg/webp. | Script-capable SVG on a public bucket. Only admins can upload. |
| S12 | L | `src/lib/validation.ts:26-31` | `checkOrigin` accepts `localhost` in production. | Rec: allow localhost only when `NODE_ENV=development`. | CSRF hygiene. Non-browser clients can forge Origin anyway. |
| S13 | L | `src/lib/rate-limit.ts` | The limiter is in-memory per instance and never evicts entries. On Vercel it is best-effort and the map grows without bound. | Rec: evict expired entries; for real limits use a Vercel KV/Upstash or Supabase counter. | Memory use and weak limits. |
| S14 | L | `src/app/api/admin/lab/jobs/[id]/download/route.ts:31-33` vs `:79` | The comment says the answer copy is gated by `callerIsEditor`, but the code passes `hasRole(…, "teacher")`. Teachers get answers, which the role design intends; the comment is wrong. | Rec: correct the comment. | The comment misleads future authorization edits. |
| S15 | L | `src/lib/lab/eeglab-store.ts:32` | The base URL was trimmed but the secret was not. A secret pasted with CR/LF (known Vercel env trap) signs links nginx rejects. | **Fixed** (trim, plus test). | Same fix as was applied to the base URL. |

Every exported `/api/admin/*` handler was checked one by one. Each one calls `requireRole`/`requireAdmin` before any data access. The exception is `stream`, which is authenticated by an HMAC minted only after `requireRole` and `canSeeRecording`. Cron routes fail closed when `CRON_SECRET` is unset; `keepalive` is intentionally public and read-only. Every table created in migrations enables RLS. No service-role key or non-`NEXT_PUBLIC` env var is referenced from any `"use client"` module.

### Correctness / efficiency

| # | Sev | Location | Finding | Status | Rationale |
|---|---|---|---|---|---|
| C1 | M | `src/app/api/admin/cases/route.ts:24`, `src/lib/qbank-server.ts:300` | `responseCount` is computed by fetching every `eeg_responses` row for all cases. PostgREST caps responses at 1000 rows by default, so counts are silently wrong once total responses pass 1000. The query is also O(responses). | Rec: an aggregate view or RPC (`select case_id, count(*) … group by`). This is a schema change. | Wrong numbers in the editor queue and the admin cases list. |
| C2 | L | `src/app/api/scan-publications/route.ts:49`, `src/app/api/admin/users/route.ts:63` | Same 1000-row cap on `publications` (211 rows today) and `user_roles`. | Rec: page with `.range()` when either approaches 1000. | Latent bug. |
| C3 | M | `src/lib/supabase.ts:20` | The legacy `supabase` export built a second browser client next to `getSupabase()`, so pages using both (`/admin`, `/profile`, every `useRole` page) ran two GoTrue instances, each with its own refresh timer and auth listener on one stored session. | **Fixed**: the export now aliases the `getSupabase()` singleton. | Avoids the multiple-GoTrueClient warning and token-refresh races. |
| C4 | M | `src/app/api/cases/[id]/respond/route.ts:35` | It resolved the responder with its own `auth.getUser(token)` network call, duplicating `admin-auth`. | **Fixed**: uses `resolveCaller`, which verifies the JWT locally first. | One auth path, and a round trip saved per answer. |
| C5 | L | `src/lib/roles-server.ts:104` | The `user_id` backfill is a fire-and-forget `void promise`. Serverless can freeze before it completes. | Rec: wrap in `after()` from `next/server`. | The backfill may never land. |
| C6 | L | `tools/eeg-render/worker.py:76` | The question-bank render worker claims atomically but has no lease, so a crashed worker leaves the job `running` forever. `lab_worker.py` already has leases. | Rec: add `lease_expires_at` reclaim, as in `lab_worker.claim_job`. | Stuck jobs need manual SQL to clear. |
| C7 | L | `src/app/api/cases/[id]/respond/route.ts` | Anonymous responders choose their own `sessionId`, so one client can inflate community stats by rotating IDs, up to the 40/h/IP limit. | Rec: accept, or count only member responses in stats. | Stats integrity. |

### Performance / bundle

| # | Sev | Location | Finding | Status | Rationale |
|---|---|---|---|---|---|
| P1 | H | `src/app/page.tsx:1-6` **(owned)** | The home page is a client component that imports `@/data/publications` (632 KB generated source) and `@/data/members` to compute counts, recent publications and a year histogram. The full dataset ships to every visitor's browser. | Rec: move the data derivation to a server component and pass props (numbers, 5 recent pubs, year counts) to a client island for the animated parts. | This is the main mobile LCP/TBT cost on the most-visited page. |
| P2 | M | `src/lib/auth.ts:5` | `useMember` imports `members` (58 KB) into `lib/auth.ts`, which 24 client modules import for `useRole`, including `Navbar` on every page. | Rec: move `useMember` to `src/lib/use-member.ts`. Its only importers are member/profile pages. | Without `sideEffects:false` the dataset may ride along in the shared chunk. |
| P3 | L | `src/app/publications/page.tsx` **(owned)**, `src/app/admin/page.tsx` | Client pages import full publication and abstract datasets. Acceptable for admin; publications is a list page. | Rec: server-render the list and filter client-side on a slimmed projection. | Bundle size. |

### Redundancy / dead code

| # | Sev | Location | Finding | Status |
|---|---|---|---|---|
| A1 | L | `switch-user`, `admin/users` POST, `authentik-callback` | The "page listUsers to find an id by email" loop was copied three times. One copy was buggy (S5). | **Fixed**: consolidated into `findAuthUserIdByEmail`. |
| A2 | L | `src/lib/case-generator.ts` | `generateCaseImage`/`imageGeneratorConfigured` (≈110 lines) are dead. Image generation moved to the queued homelab worker (`/api/admin/cases/generate-image`). | **Fixed**: removed. |
| A3 | L | `admin-auth.requireEditor`, `roles-server.getRoleForEmail`/`getRoleRow`, `cases-server.getCaseByQbankId`, `courses/types.isSubmissionStatus`, `qbank/question.optionLetter`, `qbank/retrieve.buildQuery`, `supabase.isSupabaseConfigured` | Unreferenced exports. | **Fixed**: removed. |
| A4 | M | `src/app/admin/page.tsx:39-95, 201-209, 416-469`; `src/app/api/abstract-search/route.ts` | The paste-a-citation parser and the "search abstract online" feature have state and handlers but no UI entry point. `/api/abstract-search` has no other caller. | Rec (owner decision): restore the buttons, or delete the code plus the route (≈250 lines, and it removes a public endpoint). |
| A5 | L | `src/lib/lab/types.ts:245,264,275,320` | `LabJobRequest`, `LabDryRunResponse`, `LabEnqueueResponse`, `LabEventType` are unused. | Rec: remove, or use them to type the route responses. |
| A6 | L | `UUID_RE` ×8 (lab routes, `courses/server.ts`, `annotations-server.ts`) | Duplicated regex. | Rec: export one from `src/lib/validation.ts`. The lab results route is owned. |
| A7 | L | `src/lib/lab/spec.ts:939` vs `src/lib/qbank/question.ts:~132`; `specHash` in `lab/jobs.ts` (sha256) vs `qbank/question.ts` (FNV-1a) | `stableStringify` is duplicated byte-for-byte. Two different `specHash` functions share one name. | Rec: one `stableStringify`; rename one hash (`labSpecHash`/`qbankSpecHash`). Do not change either output: both are persisted cache keys. |
| A8 | L | `shortDate` ×5, `humanDuration` ×3, `triggerDownload` ×2, `StatusChip`/`ProgressBar` ×2 across admin/course pages | Copy-pasted UI helpers. | Rec: `src/lib/format.ts` + shared components. |
| A9 | L | repo root: `temp_schema.js`, `photos_batch2.json`, `author_map.json`, `committee_pmids.json`; `tsconfig.tsbuildinfo` | One-off artefacts, all unreferenced except `author_map`/`committee_pmids` by name in `scan-publications`. Confirm before deleting. `tsconfig.tsbuildinfo` is a build cache. | Rec: delete or move to `scripts/data/`; gitignore `*.tsbuildinfo`. |

### Lint / tests / hygiene

| # | Sev | Location | Finding | Status |
|---|---|---|---|---|
| L1 | M | `package.json` | No `test` script. Two route tests need `--experimental-test-module-mocks` and failed when run plainly. | **Fixed**: `npm test` runs all 93. |
| L2 | L | 14 eslint errors (`no-explicit-any` in scripts and tests, `<a>` for internal routes in `admin/page.tsx`), plus unused vars and imports | — | **Fixed**: `Link` in the admin nav, typed test error, scoped disables in a one-off script and a fixture, unused vars removed, `ignoreRestSiblings` for the omit idiom, named eslint config export. |
| L3 | L | owned: `GalleryView.tsx:215` unused `id`, `publications/page.tsx:161` unused `uniqueConferences`, 3 `<img>` in gallery | — | Report only. |
| L4 | L | 30 `react-hooks/set-state-in-effect` warnings | Deliberately set to warn in `eslint.config.mjs`. | No action until the React Compiler is adopted. |
| T1 | M | tests | No tests cover `admin-auth.requireRole` (token → role → 401/403/503), `lab/visibility.canSeeRecording`/`canEditRecording`, the `/stream` HMAC route (forged, expired or wrong-artifact signatures), `cases/[id]/respond` grading and dedupe, `courses/server.requireCourse`, or the Authentik callback. | Rec: add these with the `mock.module` pattern used in `switch-user/route.test.ts`. They are the authorization core. |
| R1 | — | `tools/` Python (47 files) | No bare `except:`, `shell=True`, `verify=False`, `eval`, unsafe YAML or pickle. Job claims use conditional PATCH (atomic). | OK. |

## Changes on this branch

`src/app/api/admin/switch-user/route.ts` (+ `route.test.ts`), `src/lib/roles-server.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/auth/authentik-callback/route.ts`, `src/lib/supabase.ts`, `src/app/api/cases/[id]/respond/route.ts`, `src/app/api/pubmed/route.ts`, `src/lib/lab/eeglab-store.ts` (+ test), dead-code removals (A2, A3), lint fixes (L2), `package.json` test script. No renderer, synthesis, schema or owned file was changed.
