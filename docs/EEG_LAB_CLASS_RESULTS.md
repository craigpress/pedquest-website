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

## Verified 2026-09-14 (local dev against production Supabase)

Admin (throwaway `is_test` admin, deleted afterwards) → `/admin/users` shows test badges and Switch-to only on test rows, counts exclude tests → switch to Priya: banner, session is Priya, library shows member view, `annotations` returns her 3 marks with targets, `?all=1` still returns 3, results and answer key 403 → Return to admin restores the admin session → switch to Eleanor: library shows Class results on every recording and no recording pages; results page renders 10 learners with the expected per-persona numbers. Stats endpoint on the approved bank item: 11 responses in the table, 10 from test accounts, total reported 1.

Not verifiable from localhost: the viewer itself (the recording store's CORS allows pedquest.org only) — the annotation-panel target fields were type-checked and are exercised on production.
