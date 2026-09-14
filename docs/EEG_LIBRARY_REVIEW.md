# EEG Library — peer review

Since 2026-09-14 (migration `20260914_eeg_lab_review.sql`) a lab recording goes
through the same kind of editorial gate as a question-bank item before members
see it in the EEG Library. This page is the reference; `QBANK_PLATFORM.md`
describes the question-bank side it mirrors.

## Two states per job

`eeg_lab_jobs.status` is the **pipeline** state the workers own
(`pending → running → done | error | cancelled`). `review_status` is the
**editorial** state the site owns — one gate, no approved/published split:

| review_status | Who sees it | Meaning |
|---|---|---|
| `draft` | author, admins | Queued or finished, not offered to the library. Also where a recording lands after *changes requested*. |
| `pending_review` | every editor, admins | Submitted by its author; in the review queue. |
| `published` | every signed-in member | Approved by an editor other than the author. `expires_at` is cleared — the library never expires. |
| `archived` | author, admins | Rejected or taken out of the library. |

Visibility is enforced in the API routes (`src/lib/lab/visibility.ts`):
members get published recordings; editors also get everything submitted and
their own; admins get all. The rule covers the library list, the job read,
the download route and the viewer annotations.

## Authorship

* `author_id` is the editor who queued the export (the console writes it).
* Bank exports from `npm run qbank:lab-export` have no human author: `author_id`
  is null and `source = 'ai'`, like an AI-drafted question. Any editor may
  submit and any editor may review one.
* `qbank_id` is the bank link. `requested_by` still holds the old
  `qbank:<id>` / user-uuid convention so the workers and the script are
  unchanged; code reads `qbank_id ?? qbankIdOf(requested_by)`.

## Title and description

Both are learner-visible, so neither may name what was authored into the
record (background type, events, aEEG pattern) — those are the answers.
`suggestTitle` / `suggestDescription` in `src/lib/lab/library.ts` build a
spoiler-free suggestion from the spec (kind, age band, channels, montage,
duration, and the question it was made for); the recording page offers it to
the author, who edits before submitting. `npm run lab:backfill-review` wrote
the suggestion onto every existing recording.

## Workflow

1. **Build** in the console (`/admin/eeg-lab`) or via the export script. The
   job is a `draft` visible only to its author (and admins).
2. **Submit** from the recording page `/admin/eeg-lab/library/<jobId>` once the
   export is `done` and the title is set. Editors are notified (Discord +
   email, same transport as the bank).
3. **Review** from the queue `/admin/eeg-lab/review`: open the recording in
   the viewer, check it against title, description and the authored findings,
   then *Approve* / *Request changes* / *Reject* with a note. The author is
   emailed the decision.
4. **Publish gate** (DB trigger `eeg_lab_jobs_publish_gate`): `status = done`,
   a title, and `reviewed_by` set to someone other than `author_id`
   (four eyes; skipped for AI recordings, which have no author). The trigger's
   message is returned verbatim by the API when it refuses.
5. **With a question:** on the question's editor page, the reviewer can tick
   *"I reviewed the full EEG recording …"* and the approval publishes the
   recording too, through the same checks. Recordings are otherwise reviewed
   independently of their question.

## Grandfathering

Every export that existed at migration time (53 on 2026-09-14) was already
visible to members, so it was published with `grandfathered = TRUE`. The
library shows those to editors under *Legacy · not yet reviewed*; a later
review clears the flag and the full gate applies from then on.

## Tables

* `eeg_lab_jobs` — new columns `review_status, author_id, source, qbank_id,
  title, description, grandfathered, submitted_at, reviewed_by, reviewed_at,
  published_at`.
* `eeg_lab_reviews` — `job_id, reviewer, reviewer_email, decision
  (approved | changes_requested | rejected), notes, created_at`.

## Routes

* `GET /api/admin/lab/library?review=…` — adds `review` filter
  (`draft | pending_review | published | archived | legacy | mine`) and
  `facets.review` counts.
* `GET|POST /api/admin/lab/jobs/<id>/review` — `save`, `submit`, `withdraw`,
  `review`, `unpublish` (admin), `notify`.
* `POST /api/admin/qbank/<id>` action `review` accepts `alsoRecordings: [jobId]`.

## Worker note

`tools/eeg-render/lab_worker.py` now copies `author_id / source / qbank_id`
onto the Persyst follow-on row it queues, so an editor's console shows the
child next to its export. Until that worker build is deployed
(`reference_pedquest_render_host_deploy`), new Persyst rows are visible to
admins only; nothing else depends on it.
