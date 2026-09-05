---
tags:
  - domain/infrastructure
  - type/reference
  - project/pedquest
  - domain/eeg-monitoring
---
# qEEG Question Bank — platform reference

How the question bank is stored, who may change it, and how content gets from
`content/qbank/questions/*.yaml` to a learner's screen.

Written 2026-09-03. Companion docs: `EEG_CASE_OF_THE_DAY.md` (the daily case
feature this extends), `CASE_IMAGE_SOURCING_POLICY.md` (image licensing),
`content/qbank/README.md` (the content contract).

---

## 1. Data model

Everything lives on the existing `eeg_cases` family. A bank item **is** an
`eeg_cases` row with `in_bank = true` and a `qbank_id`; the Case of the Day is
the same row published on a date. Nothing was renamed or dropped.

| Table | Purpose |
|---|---|
| `user_roles` | `email` (PK, lowercase) → `member` \| `editor` \| `admin`, plus `user_id`, `granted_by`, `granted_at`. Replaces the hardcoded email allowlist. |
| `eeg_cases` | The item. New columns: `qbank_id` (unique, e.g. `PQ-A-007`), `domain`, `population`, `setting`, `bloom`, `learning_objective`, `lead_in`, `image_caption`, `key_points[]`, `version`, `content` (whole YAML snapshot), `spec` + `spec_hash` (image spec), `image_sidecar`, `in_bank`, `generation_job_id`. |
| `eeg_case_options` | Options + per-option rationales (unchanged shape). |
| `eeg_case_references` | The evidence trail: `pmid`, `doi`, `url`, `citation`, `role` (primary/supporting), `verified`, `verified_by`, `open_access`, `member_author`, `sort_order`. |
| `eeg_case_revisions` | Append-only content history, written by a trigger. |
| `eeg_case_reviews` | Editor decisions: `approved` \| `changes_requested` \| `rejected`, with notes. |
| `eeg_case_generation_jobs` | One row per pipeline draft attempt: retrieval, draft, critic report, outcome. |
| `eeg_case_render_jobs` | The contract with the Python renderer (see §5). |

`user_roles` is keyed on email, not `user_id`, because the Authentik bridge
mints the Supabase user lazily — a role can be granted before that person has
ever signed in. `user_id` is backfilled on their first authenticated request.

Migration: `supabase/migrations/20260903_qbank.sql`. Additive and idempotent.

## 2. Roles

| Role | Can |
|---|---|
| `member` | Sign in; answer question-bank items and the Case of the Day; see their own progress. |
| `editor` | Everything a member can, plus the `/admin/qbank` console: read the whole pipeline, edit items, verify PMIDs, re-render images, review, and publish. |
| `admin` | Everything an editor can, plus `/admin/users` (grant roles), deleting items, and the pre-existing `/admin` screens. |

Three things changed together, and they must stay in step:

* `src/lib/admin-auth.ts` — `requireRole(request, 'editor' | 'admin')` validates
  the caller's Supabase access token and looks the role up. `requireAdmin` is a
  wrapper, so every existing admin route keeps working.
* The client gates (`/admin`, `/admin/cases`, `/admin/events`, `/profile`,
  `/admin/qbank`, `/admin/users`) call `useRole()`, which reads `GET /api/me`.
* SQL `public.is_pedquest_admin()` and the new `public.is_pedquest_editor()`
  read `user_roles`. Both are `SECURITY DEFINER` — required, because
  `user_roles`' own RLS policies call them and `SECURITY INVOKER` would recurse.

Both login paths register the member: the Authentik callback calls
`ensureUserRole()` directly, and the magic-link callback page calls `/api/me`,
which does the same upsert. New people land as `member`; an existing role is
never downgraded by a login.

The four founding admins (`pressca@chop.edu`, `craigpress@gmail.com`,
`gbenedet@med.umich.edu`, `ajay.thomas@bcm.edu`) are seeded by the migration.

**Ordering matters.** There is no hardcoded fallback any more. If the code is
deployed before the migration is applied, every role check fails and admin
pages lock out. Apply the migration first. (`ensureUserRole` logs a loud
`public.user_roles does not exist` if that happens.)

## 3. The publish gate

Enforced by a database trigger, not by application code, so it holds no matter
which path writes the row. A case may only move to `approved` or `published`
when all three are true:

1. `image_license` is set,
2. at least one `eeg_case_references` row has `verified = true`,
3. `reviewed_by` is set and differs from `created_by` (four eyes).

The trigger raises one exception naming everything that is missing; the editor
console shows that message verbatim. A second trigger snapshots the superseded
`content` into `eeg_case_revisions` and bumps `version` on any content-bearing
UPDATE.

RLS: anon reads published cases only (unchanged); editors read and edit the
whole pipeline; only admins delete or change roles; responses stay per-user; the
service role bypasses everything.

## 4. Import pipeline

```
content/qbank/questions/<ID>.yaml  →  npm run qbank:validate
                                   →  npm run qbank:import        →  eeg_cases (pending_review)
public/images/qbank/<ID>.png/.json ↗
```

* `npm run qbank:validate` — JSON Schema (draft 2020-12) via ajv, every PMID
  resolved against PubMed esummary (rate-limited to ~2.5 req/s), near-duplicate
  stem detection by normalized token overlap, plus the checks the schema cannot
  express (exactly one correct option, no "all of the above", a primary
  reference, a deterministic `image.spec.seed`). `--skip-pmid` runs offline;
  `--dir <path>` validates one directory. Exit 1 on any error.
* `npm run qbank:import` — upserts by `qbank_id`. New items land as
  `pending_review`. **Items already `approved` or `published` are never
  downgraded**: their content is updated, `version` is bumped (which makes the
  trigger write a revision) and a `changes_requested` review note "needs
  re-review" is filed so an editor sees it in the queue. `--dry-run` prints the
  plan and writes nothing; `--only <ID>` and `--dir <path>` narrow it.
* A `point_to_feature` item's answer region comes from its verified renderer
  sidecar. Render missing images before importing question content.
* Before any database access, import verifies every selected PNG/sidecar against
  the current Python renderer and question specification. This requires the
  renderer's Python dependencies locally. Existing case source classification is
  preserved, and concurrent version changes abort that case's update.
* An unverified reference blocks the item: the publish gate needs a verified
  one, so importing it would only create something that cannot be approved.

## 5. Render pipeline

`eeg_case_render_jobs` is the contract with `tools/eeg-render`. **Do not rename
these columns.**

| Column | Written by | Meaning |
|---|---|---|
| `id`, `case_id`, `spec`, `created_at` | website | the job |
| `status` | worker | `pending` → `running` → `done` \| `error` |
| `image_url` | worker | public URL / path of the PNG |
| `sidecar` | worker | `{answer_region, width, height, spec_hash, renderer_version}` |
| `error` | worker | why it failed |

The worker polls for `status = 'pending'`, claims the row, renders from `spec`,
and writes the result back, including the case image attachment. The editor
console polls `GET /api/admin/qbank/render?jobId=…`; that route is read-only and
reports `done` only when the completed job's image URL and specification are
still attached to the case. A stale completed job is reported as superseded.

## 6. Generation pipeline

Weekly cron → `GET /api/cron/qbank-generate` (guarded by `CRON_SECRET`,
Monday 09:00 UTC in `vercel.json`). Per draft:

1. **blueprint** (`src/lib/qbank/blueprint.ts`) — parse `BLUEPRINT.md`, compare
   targets with what the bank holds, pick the domains that are shortest and
   draw a topic from that domain's scope text (skipping objectives already
   covered or already queued).
2. **retrieve** (`retrieve.ts`) — PubMed esearch/efetch, narrowest query first,
   falling back to broader ones. Only those abstracts reach the model.
3. **draft** (`draft.ts`) — one chat call. The system prompt is assembled from
   `STYLE_GUIDE.md` + `question.schema.json` + the exemplar in
   `content/qbank/examples/`, so the model is held to the same rules the
   validator enforces. Output is JSON matching the schema, with
   `metadata.source_method = "ai-generated-pipeline"` and `source = "ai"`.
4. **critic** (`critic.ts`) — deterministic checks: every number in the stem or
   explanation appears verbatim in a retrieved abstract; one best answer with
   homogeneous options and real rationales; ACNS terminology; copyright and
   de-identification risk; references present and drawn from the retrieved set;
   near-duplicate of an existing stem. Plus an advisory LLM cover test. Any
   error marks the job `failed` with reasons and writes nothing.
5. **verify** (`verify.ts`) — each cited PMID is resolved on PubMed and the
   citation's first author and year are checked against the record.
6. Passing drafts become `pending_review` (or `draft` if the critic raised
   warnings), a render job is enqueued, and the editors get one digest through
   `src/lib/notifications.ts`.

Provider abstraction (`provider.ts`): `QBANK_PROVIDER` picks `openwebui`
(default when `OPENWEBUI_*` is set), `anthropic` (official SDK, `claude-opus-5`
unless `ANTHROPIC_MODEL` says otherwise), or `mock`. With nothing configured the
mock provider still exercises retrieval, prompt assembly, the critic and the row
mapping — useful for a dry run, but it cannot produce an item.

`npm run qbank:generate -- --dry-run` prints the plan, the retrieval, the critic
report and the draft without writing. `--count N`, `--domain`, `--topic` narrow
it.

**Time budget.** Vercel caps function duration (60s on Hobby). The orchestrator
stops starting new drafts once `QBANK_GENERATE_BUDGET_MS` (default 45 000) has
elapsed and reports what it skipped. Lower `count`, or run the cron more often —
do not raise the budget above the platform limit.

## 6a. Feedback → revision loop (AI items)

Requesting changes on an **AI-generated** item automatically feeds the review
notes back to the model, re-checks the result and re-renders the image — the
editor does not hand-edit the spec. Human-authored items are unaffected (their
"request changes" just returns them to the queue; edit the spec and re-render).

Flow (`src/lib/qbank/revise.ts`):

1. A `changes_requested` review on an item with `source = 'ai'` inserts an
   `eeg_case_generation_jobs` row with `mode = 'revision'`, `case_id`, and the
   notes in `feedback` (status `pending`).
2. `processRevisionJob` runs: **revise** (one chat call — the model gets the
   whole current item JSON and is told to EDIT it, keeping everything the
   feedback does not touch and preserving the id, references and PMIDs; it is
   not a redraft) → **critic** → **write** the revised JSON onto the case (the
   `version_bump` trigger snapshots a revision and increments `version`) →
   **enqueue a render** from the new spec → status `pending_review`.
   - **Evidence reuse.** The abstracts that grounded the original draft are
     stored on the first generation job's `retrieval`. The reviser re-receives
     them, so the model reuses the same sources rather than inventing new ones,
     and the numbers-sourced + references checks run against that corpus exactly
     as for a fresh draft. For a human-authored item there is no stored corpus,
     so those two checks are skipped (structure, one-best-answer, ACNS
     terminology, copyright and live PMID existence still run) and the editor is
     the backstop.
3. It runs three ways: **inline** right after the review (the console shows the
   revised draft and new image), on demand via **"Revise with AI now"**
   (`POST {action:"regenerate"}`), and in **bulk from the weekly cron**
   (`drainRevisionJobs`, which also resets any revision stuck in `running` >10
   min from a function timeout). So it is automated whether or not anyone
   presses the button.

A failed revision leaves the job `failed` with the reason and the item in the
queue; the editor can retry or edit by hand. Editing the spec in the save form
also auto-enqueues a render now (no separate button needed).

## 7. Editor workflow

`/admin/qbank` — the queue: per-status counts, filters (status, domain,
difficulty, population, source), and a readiness line per item
(`n/m refs verified`, license, responses).

`/admin/qbank/<id>` — the item:

* the rendered image with an answer-region overlay toggle (from
  `image_sidecar`), and **Re-render**, which enqueues a render job and polls it;
* every field editable — stem parts, options with rationales and the correct
  flag, explanation, key points, tags, classification, image license and
  attribution;
* references with a **Verify PMID** button
  (`/api/admin/qbank/verify-pmid`) that checks the record *and* whether the
  citation's author and year agree with it;
* **Approve / Request changes / Reject** with notes — writes
  `eeg_case_reviews`, sets `reviewed_by`, moves the status, and surfaces the
  database gate's error text if the transition is refused;
* revision history with a side-by-side `content` diff;
* **Schedule as Case of the Day** — sets `publish_date` and publishes.

You cannot approve an item you created; the UI says so and the trigger enforces
it independently.

## 8. Learner experience

* `/education/question-bank` — public landing with facet counts and a sign-in
  prompt; signed-in members get filters (domain, difficulty, population,
  setting), an "unanswered only" toggle, and per-domain progress.
* `/education/question-bank/<id>` — the item, reusing `CaseQuiz`: lead-in,
  image caption, per-option rationales, key points, the cited evidence with
  PubMed links, and an image credit line.
* `/education/question-bank/practice` — a random unanswered published item, with
  "next question" after each reveal.
* Progress comes from `eeg_responses`, computed server-side.

Answers are still graded server-side in `/api/cases/[id]/respond`; nothing the
browser receives before submitting contains the answer.

## 9. Environment variables

Already set in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, and
(production only) `OPENWEBUI_BASE_URL` / `OPENWEBUI_API_KEY` / `OPENWEBUI_MODEL`.

New, all optional:

| Variable | Default | Purpose |
|---|---|---|
| `QBANK_PROVIDER` | auto | `openwebui` \| `anthropic` \| `mock` |
| `ANTHROPIC_API_KEY` | — | enables the Claude provider |
| `ANTHROPIC_MODEL` | `claude-opus-5` | model for that provider |
| `QBANK_GENERATE_BUDGET_MS` | `45000` | when the cron stops starting new drafts |
| `QBANK_LLM_TIMEOUT_MS` | `40000` | per-model-call timeout |

`AUTHENTIK_CLIENT_ID` / `AUTHENTIK_CLIENT_SECRET` are unchanged.

## 10. Runbook

**Apply the migration** (do this before deploying the code):

1. Open the Supabase SQL editor for the project and paste
   `supabase/migrations/20260903_qbank.sql`, or run `supabase db push`.
2. Check the seed: `select email, role from user_roles order by role;` should
   list the four admins.
3. Sign in and open `/admin/users`. If it loads, the role plumbing is live.

**Import the content:**

```bash
npm run qbank:validate                 # schema + PMIDs + duplicates
npm run qbank:import -- --dry-run      # read the plan
npm run qbank:import                   # write
```

**Run the render worker** (another agent owns `tools/eeg-render`): point it at
the same Supabase project with the service-role key; it polls
`eeg_case_render_jobs` for `status = 'pending'`. Re-run `qbank:import`
afterwards to pick up the sidecars for `point_to_feature` items.

**Review and publish:** `/admin/qbank`, filter to `pending_review`, open an
item, fix what needs fixing, verify the PMIDs, Approve, then Schedule.

**Generation:** the weekly cron runs itself. To try it by hand:

```bash
npm run qbank:generate -- --dry-run --count 1
```
