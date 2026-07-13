# qEEG "Case of the Day" — feature branch

Branch: `feature/eeg-case-of-the-day`

A daily EEG/qEEG teaching image + quiz, a browsable archive, per-member answer
capture, a community heat-map for "point to the feature" questions, and an admin
CMS where the team authors cases or approves AI-drafted ones.

## What ships in this branch

| Area | Path |
|---|---|
| DB migration (tables, RLS, storage bucket, 2 demo cases) | `supabase/migrations/20260714_eeg_cases.sql` |
| Types + geometry (framework-agnostic) | `src/lib/cases.ts` |
| Server data access (service-role, answer-stripping) | `src/lib/cases-server.ts` |
| Server-side admin auth (verifies Supabase JWT) | `src/lib/admin-auth.ts` |
| AI generator (OpenWebUI → Claude) | `src/lib/case-generator.ts` |
| Answer + grade endpoint | `src/app/api/cases/[id]/respond/route.ts` |
| Public aggregate stats | `src/app/api/cases/[id]/stats/route.ts` |
| Admin CRUD / lifecycle | `src/app/api/admin/cases/route.ts` |
| AI draft generation | `src/app/api/admin/cases/generate/route.ts` |
| De-identified image upload | `src/app/api/admin/cases/upload/route.ts` |
| Quiz UI (MC + point-to-feature + heat-map) | `src/components/CaseQuiz.tsx` |
| Archive card | `src/components/CaseCard.tsx` |
| Today / archive / single-case pages | `src/app/education/case-of-the-day/**` |
| Admin console | `src/app/admin/cases/page.tsx` |
| Synthetic demo images + generator | `public/images/eeg-cases/*.svg`, `scripts/gen-sample-eeg.mjs` |

Public routes: `/education/case-of-the-day`, `/education/case-of-the-day/archive`,
`/education/case-of-the-day/[id]`. Admin: `/admin/cases`.

## To make it live

1. **Run the migration** in the Supabase SQL editor:
   paste `supabase/migrations/20260714_eeg_cases.sql`. It is idempotent and seeds
   two synthetic demo cases (no patient data).
2. **Env vars** (Vercel + `.env.local`) — the AI generator is optional; everything
   else works without it:
   ```
   OPENWEBUI_BASE_URL=https://your-openwebui-host      # no trailing /api
   OPENWEBUI_API_KEY=sk-...                              # OpenWebUI API key
   OPENWEBUI_MODEL=claude-opus-4-8                       # a model the instance exposes
   ```
   (Reuses the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.)
3. **Admin allowlist** lives in `src/lib/admin-auth.ts` (`ADMIN_EMAILS`) — keep it in
   sync with the client list in `src/app/admin/page.tsx`.
4. Deploy. Visit `/admin/cases` (signed in as an admin) to author or generate cases.

## Security model (deliberate — addresses the audit)

- **Answers never reach the client early.** `eeg_case_options.is_correct`, correct
  regions, and raw responses are readable only via the **service-role** key. The
  public page is a server component that strips answers; grading happens server-side
  in `/api/cases/[id]/respond`, so `is_correct` cannot be spoofed.
- **Real server-side admin checks.** Unlike the current client-only gate, every write
  route calls `requireAdmin()`, which validates the caller's Supabase JWT and checks
  the allowlist. RLS denies anon writes as defense-in-depth (`USING (false)`).
- **Storage** bucket `eeg-cases` is public-read, service-role-write; uploads go through
  the admin upload route (admin-verified), never a public client.
- **One response per member / per anonymous session** (partial unique indexes).

## Answering & analytics

- Anyone can answer. Signed-in members are recorded by `user_id` (+ `member_email`);
  anonymous visitors by a `session_id` stored in `localStorage`.
- `eeg_responses` stores the choice or the normalized `(x,y)` point and the graded
  `is_correct`. The reveal returns aggregate community stats; point-to-feature reveals
  a heat-map of everyone's clicks plus the correct region.

## AI generation + human approval

`/admin/cases` → **Generate with AI** → prompts for a topic → `POST
/api/admin/cases/generate` calls OpenWebUI (OpenAI-compatible `/api/chat/completions`)
with a strict-JSON system prompt. The draft lands as `status = 'pending_review'`,
`source = 'ai'`. **A human must attach a de-identified image, verify the answer, and
approve/publish.** The model drafts the question/answer/teaching only — it does not
supply clinical images.

> **Clinical/IP/PHI guardrail:** only ever attach **licensed, de-identified** EEG
> images. No patient identifiers, MRNs, dates, or faces. The repo is public — the demo
> images are synthetic (drawn), not real recordings.

## Verified

- `npx tsc --noEmit`: feature files clean.
- `next build`: compiles, type-checks, generates all routes (see the route table in the
  build output). Also fixed a **pre-existing** build blocker in
  `scripts/backfill-member-tags.ts` (supabase-js v2 `.update()` typed as `never`) that
  was failing `next build` on `main`.

## Follow-ups (not in this branch)

- Add a nav link (`Navbar.tsx`) to the feature; an education-page CTA is included.
- Move response aggregation to a Postgres RPC / materialized view once volume grows
  (currently aggregated in `getCaseStats`).
- Richer correct-region shapes in the admin editor (circle/polygon; the schema and
  renderer already support them — the editor currently exposes a rectangle).
- Keyboard-first flow for point-to-feature is supported (arrow keys + Enter); add a
  full a11y pass before wide release.
