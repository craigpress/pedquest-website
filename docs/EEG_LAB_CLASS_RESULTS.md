# EEG Teaching Lab — class results, teacher role, test accounts

Shipped 2026-09-14/15. Migration `supabase/migrations/20260915_teacher_role_test_users_annotation_targets.sql`.

## Roles

`member < teacher < editor < admin` (`src/lib/roles.ts`, `user_roles.role`).

| Capability | member | teacher | editor | admin |
|---|---|---|---|---|
| Mark a recording (own marks only) | ✓ | ✓ | ✓ | ✓ |
| See every learner's marks (`?all=1`), class results, answer key | | ✓ | ✓ | ✓ |
| Review / edit / publish bank items and recordings | | | ✓ | ✓ |
| Manage roles, switch into test accounts | | | | ✓ |

Server gates: `requireRole(request, "teacher")` on `/api/admin/lab/jobs/[id]/results`; `hasRole(role, "teacher")` for `?all=1` on the annotations route and for `resolveArtifact`'s instructor copies (answer key, Persyst trends CSV). SQL mirror: `is_pedquest_teacher()` backs the annotations read policy; `is_pedquest_editor()` is unchanged.

Teachers see the published library like a member (no recording page, no review queue) plus a **Class results** link per recording. The `/admin/eeg-lab/library/[jobId]/results` page is the teacher landing.

### In the viewer

- **Teacher:** the annotation panel's filter is a dropdown — everyone · mine only · one learner by display name — and it drives what the raw pane and trend strip draw, not just the list. Marks by others are dashed and carry the author's name (email on hover). A **Class results** link sits in the header. Deep links: `?job=…&t=<seconds>` seeks to a mark, `&learner=<email>` starts filtered to that learner; class results uses both (per learner, per mark, per key event).
- **Learner:** the header states the task ("mark every electrographic seizure from onset to offset … and say which channels or region") and that marks are private to them and their instructors. They see only their own marks; `?all=1`, the answer key and the results route all refuse.

## What a mark is now

`eeg_lab_annotations` = time + kind + **target**:

| column | meaning |
|---|---|
| `onset_s`, `duration_s` | span; `duration_s = 0` is an instantaneous mark |
| `kind` | seizure · seizure_onset · discharge (sharp/spike) · artifact · state_change · medication · note |
| `pane` | `raw` or `trend` — where the learner made the mark |
| `trend_row` | `psd_right`, `aeeg_left`, … when `pane = trend` |
| `channels` | electrode or derivation labels the learner points at (`{C4}`, `{C4-P4}`); empty = not stated |
| `region` | the head region the learner names (`LabRegion` vocabulary); null = not stated |

The viewer fills the target from where the click happened (raw pane → the derivation under the pointer; trend strip → the row) and lets the learner edit it in the annotation panel. Old rows read as `raw` / no channel / no region — which is what they were.

This is what lets one recording carry different question types: "mark the seizures" (span), "mark the onset" (point), "find the sharp wave over C4" (point + channel), "point to the flame on the right FFT" (point on a trend row). The isomorphic types live in `src/lib/eeg/annotations.ts`.

## Scoring (`src/lib/lab/scoring.ts`)

A **task** says what was asked and how to grade: `type` (span · point · channel_point · trend_point), which learner kinds count, which key kinds they are graded against, and a time tolerance. `SEIZURE_TASK` (tolerance ±30 s) always runs; `DISCHARGE_TASK` (±2 s) runs when the key or a learner has discharges.

Matching is one-to-one, greedy by best temporal fit (IoU for spans, distance-to-onset for points). Per learner: detected / key events (sensitivity), false alarms (unmatched marks), precision, F1, median onset latency (+ = late), median duration error, mean overlap, localization tally, pane split, and a **composite 0–100** = 50 % F1 + 30 % timing (1 − |latency|/tolerance) + 20 % localization (when the learner localized at least once; otherwise the 20 % folds into F1).

**Localization** compares what the learner said about *where* with the key's `onset_region`: the stated `region` wins; else regions inferred from `channels` (electrode → region table, derivations contribute both ends); else a `_left`/`_right` trend row gives hemisphere-level. Grades: `match` (same region), `partial` (same hemisphere / hemisphere-vs-lobe / lateralized answer to a generalized key), `miss` (wrong side), `not_stated`. Not stated is never counted as wrong.

Class roll-up: per key event, who detected it and the median latency; mean sensitivity, mean false alarms per learner, median composite. Instructors' (teacher+) own marks are listed but excluded from every class number.

## Test accounts and switching

`user_roles.is_test = true` marks a synthetic account. Test accounts:
- are excluded from Case-of-the-Day community stats (`getCaseStats`) and from the admin `/admin/users` counts (they get their own `test` count and chip);
- are **kept** in learner-facing teacher views — that is what they are for;
- are the only accounts an admin can switch into.

**Switch-user** (`POST /api/admin/switch-user`, admin only): refuses unless the target row has `is_test`, then mints a magic-link `hashed_token` server-side (same mechanism as the Authentik bridge). The client (`src/lib/impersonation.ts`) stashes the admin session in `localStorage.pq_admin_session`, calls `verifyOtp`, and does a full navigation; `ImpersonationBanner` (mounted in `layout.tsx`) shows "Viewing as … · test account · Return to admin", which restores the stashed session. Every switch is logged server-side (`[switch-user] <admin> → <target>`).

### The cohort

`npm run test-learners -- seed | status | reset` (`scripts/test-learners.ts`). Ten learners + one teacher, emails `first.last@test.pedquest.invalid` (undeliverable by RFC 2606), display names set, all `is_test`. Marks are derived from the answer key of **PQ-A-013** (`c49a74fc-…`, 4 h, three ~45 s right frontal/central seizures) with a seeded PRNG, one persona each:

| learner | persona |
|---|---|
| Priya Raman, Marcus Delgado | all three, tight timing, right-sided channels + region |
| Hannah Okafor | all three from the right FFT: +12–28 s late, no channels |
| Tomasz Wieczorek, Aisha Bello | skip the shortest seizure |
| Liam Fitzgerald | all three plus two false alarms (one on the left FFT) |
| Mei-Lin Chou | instantaneous `seizure_onset` marks with C4/F4 |
| Diego Fernández | right timing, left-hemisphere channels and region |
| Sofia Lindqvist | one seizure, 24 s late, plus a trend note |
| Kwame Asante | two artefact marks, no seizures |
| Eleanor Whitfield | teacher, no marks |

Each learner also has one answer on the approved bank item (60 % correct) so the stats exclusion can be checked: the item's public `/api/cases/[id]/stats` total must not include them. `reset` deletes the annotations, the bank answers and the auth users (`user_roles` cascades).

## Courses (migration `20260915_eeg_courses.sql`)

The classroom layer, shaped like Google Classroom / Canvas: **course → roster → assignments → one submission state per
student per assignment**, with the gradebook and every KPI derived rather than stored.

- **Tables:** `eeg_courses` (owner = the teacher who created it), `eeg_course_members` (email-keyed like `user_roles`; `user_id`
  backfilled on the student's first visit; role student | instructor), `eeg_course_assignments` (one published recording +
  instructions + due date + scoring task), `eeg_course_submissions` (`in_progress` | `submitted` | `returned`, opened/submitted/
  returned timestamps, feedback). RLS on, no policies — the routes gate in code (`src/lib/courses/server.ts`).
- **Who can do what:** *manage* = owner, an instructor member, or a site admin — create (teacher+), edit, add/remove students,
  assign/remove recordings, return with feedback, see the gradebook and course-scoped class results. *View* = any student on
  the roster — their assignments, own status, feedback. Anyone else gets 404. A course instructor need not hold the site
  `teacher` role; the course itself grants them the instructor view of *that* course.
- **Submission states:** `not_started` (no row, no marks) → `in_progress` (opened from the course, or any mark exists) →
  `submitted` ("Done with this EEG" in the viewer or on the course page; can be reopened) → `returned` (teacher wrote feedback).
  `late` = submitted after the due date. Grades are not stored: each teacher view re-runs the class-results scoring on the
  student's current marks, and a **student sees no score** — only their status and the teacher's feedback.
- **KPIs (course page, teachers):** students, assignments, completion (turned-in cells / students × assignments), on-time share of
  turned-in cells with a due date, mean composite score, mean sensitivity, false alarms per learner, median onset latency; per
  assignment a stacked not-started / in-progress / done / returned bar with mean score and late count; per student done/total,
  mean score, last activity. Class results accepts `?course=<id>` to restrict to the roster and adds a course-status column.
- **Routes:** `GET|POST /api/courses`, `GET|PATCH|DELETE /api/courses/[id]`, `POST|DELETE …/members`, `GET /api/courses/people?q=`
  (teacher+, consortium members ∪ accounts), `POST …/assignments`, `GET|PATCH|DELETE …/assignments/[aid]`,
  `POST …/assignments/[aid]/submission` (`open` | `submit` | `unsubmit` by the student, `return` by a manager). Recordings are
  picked from the existing `/api/admin/lab/library`; only published ones can be assigned.
- **Pages:** `/courses` (My courses · Teaching · New course), `/courses/[id]` (teacher: KPIs, assignments, gradebook, add
  students/EEGs; student: assignment list with Open / Done / Reopen). The viewer takes `&course=&assignment=`: it records
  "opened", shows the assignment title, instructions and due date in the header, and offers Done / Reopen; "← Course" goes back.
- **Demo course** from `npm run test-learners -- seed`: "qEEG Seizure Detection — Fall 2026" owned by Eleanor Whitfield, ten
  students, three assignments (PQ-A-013 past due — eight turned in, two late, one returned with feedback, two in progress;
  PQ-A-012 opened by two; PQ-A-020 untouched). `reset` removes it first (everything under it cascades).

## Verified 2026-09-14 (local dev against production Supabase)

Admin (throwaway `is_test` admin, deleted afterwards) → `/admin/users` shows test badges and Switch-to only on test rows, counts exclude tests → switch to Priya: banner, session is Priya, library shows member view, `annotations` returns her 3 marks with targets, `?all=1` still returns 3, results and answer key 403 → Return to admin restores the admin session → switch to Eleanor: library shows Class results on every recording and no recording pages; results page renders 10 learners with the expected per-persona numbers. Stats endpoint on the approved bank item: 11 responses in the table, 10 from test accounts, total reported 1.

Not verifiable from localhost: the viewer itself (the recording store's CORS allows pedquest.org only) — the annotation-panel target fields were type-checked and are exercised on production.

## Localhost: same-origin recording proxy

The homelab recording store (`eeglab.presshome.net`) sends
`Access-Control-Allow-Origin` for `https://pedquest.org` only. So on any other
origin the viewer's Range reads die as "Failed to fetch" before the signed URL
is ever evaluated — a CORS failure, not an auth failure, and no amount of
re-signing fixes it. That is why the viewer was previously untestable from
`http://localhost`.

`GET /api/admin/lab/jobs/<id>/stream?artifact=<a>&exp=<unix>&sig=<hex>` proxies
the bytes on this origin. It fetches the store server-side (where CORS does not
apply), forwards the incoming `Range` and `If-None-Match`, and streams the
response back with `Content-Type`, `Content-Length`, `Content-Range`,
`Accept-Ranges`, `ETag` and `Last-Modified` copied through and
`Cache-Control: private, no-store`. `HEAD` is handled the same way.

**How it authenticates.** The browser fetches this URL with no Bearer token —
`RangeByteSource` sends `Range` and nothing else. So `sig` *is* the
authentication: `HMAC-SHA256(EEG_LAB_URL_SECRET, "<jobId>|<artifact>|<exp>")`,
hex, compared with `timingSafeEqual`. The download route mints it only after
`requireRole` **and** `resolveArtifact` have both passed, so the stream route
does not re-run the role gate — it would be re-asking a question already
answered by a caller it can no longer see. It still checks job state: not
`done`, or no such artifact, is refused. Missing or wrong `sig` → 403; a valid
signature past its `exp` → 410. Same TTL as the store links
(`LAB_SIGNED_URL_TTL_S`, 120 s); the viewer re-mints on 403.

**When it is used.** `sameOriginProxyEnabled()` is true when
`EEG_LAB_SAME_ORIGIN_PROXY=1` or `NODE_ENV === "development"`. Then
`/download` returns the relative `/api/admin/lab/jobs/<id>/stream?…` path as its
`url` and reports `via: "proxy"`; everything else in the response is unchanged.
Production does **not** set the flag, so it keeps returning direct store /
Supabase Storage URLs (`via: "direct"`) and the bytes never transit the Next
server. With `EEG_LAB_URL_SECRET` unset there is no HMAC to mint, and the route
falls through to the direct URL regardless of the flag.
