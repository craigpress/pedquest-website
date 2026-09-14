-- ============================================================
-- EEG Library editorial review
-- Migration: 20260914_eeg_lab_review
--
-- Mirrors the question bank's peer review (20260903_qbank.sql) on the lab
-- recordings. `eeg_lab_jobs.status` stays the PIPELINE state the workers own
-- (pending → running → done); `review_status` is the EDITORIAL state the
-- site owns:
--
--   draft           the author's own; only the author and admins see it
--   pending_review  submitted; every editor sees it in the review queue
--   published       in the EEG Library for every signed-in member
--   archived        rejected or withdrawn from the library
--
-- Single gate (no approved/published split): "publish" is the approval.
--
-- Authorship: `author_id` is the editor who queued the export. Bank exports
-- (scripts/qbank-lab-export.ts) have no human author and are `source = 'ai'`,
-- like AI-drafted question-bank items. `qbank_id` replaces the
-- `requested_by = 'qbank:<id>'` convention as the bank link; requested_by is
-- kept as written so the workers and the export script keep working.
--
-- Grandfathering: every export row that exists when this runs was already
-- visible to members, so it is published here with `grandfathered = TRUE`.
-- The flag marks it as never peer-reviewed; a later review clears it.
--
-- Additive only. Both workers PATCH explicit columns and INSERT with the
-- defaults, so they need no change to keep running.
-- ============================================================

ALTER TABLE public.eeg_lab_jobs
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS author_id     UUID,
  ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'team',
  ADD COLUMN IF NOT EXISTS qbank_id      TEXT,
  ADD COLUMN IF NOT EXISTS title         TEXT,
  ADD COLUMN IF NOT EXISTS description   TEXT,
  ADD COLUMN IF NOT EXISTS grandfathered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by   UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_lab_jobs_review_status_chk') THEN
    ALTER TABLE public.eeg_lab_jobs
      ADD CONSTRAINT eeg_lab_jobs_review_status_chk
      CHECK (review_status IN ('draft','pending_review','published','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_lab_jobs_source_chk') THEN
    ALTER TABLE public.eeg_lab_jobs
      ADD CONSTRAINT eeg_lab_jobs_source_chk CHECK (source IN ('team','ai'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS eeg_lab_jobs_review_idx
  ON public.eeg_lab_jobs (stage, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS eeg_lab_jobs_qbank_idx  ON public.eeg_lab_jobs (qbank_id);
CREATE INDEX IF NOT EXISTS eeg_lab_jobs_author_idx ON public.eeg_lab_jobs (author_id);

-- ---------- reviews (editor decisions), same shape as eeg_case_reviews ----------
CREATE TABLE IF NOT EXISTS public.eeg_lab_reviews (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id         UUID NOT NULL REFERENCES public.eeg_lab_jobs(id) ON DELETE CASCADE,
  reviewer       UUID,
  reviewer_email TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('approved','changes_requested','rejected')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_lab_reviews_job_idx ON public.eeg_lab_reviews (job_id, created_at DESC);

ALTER TABLE public.eeg_lab_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eeg_lab_reviews_editor_read ON public.eeg_lab_reviews;
CREATE POLICY eeg_lab_reviews_editor_read ON public.eeg_lab_reviews
  FOR SELECT USING (public.is_pedquest_editor());
-- Writes go through the service-role client behind requireRole('editor').

-- ---------- backfill ----------
-- bank link + AI authorship from the requested_by convention
UPDATE public.eeg_lab_jobs
   SET qbank_id = substr(requested_by, length('qbank:') + 1),
       source   = 'ai'
 WHERE requested_by LIKE 'qbank:%'
   AND qbank_id IS NULL;

-- human author from the uuid the console wrote into requested_by
UPDATE public.eeg_lab_jobs
   SET author_id = requested_by::uuid
 WHERE author_id IS NULL
   AND requested_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- grandfather every export that already exists (see header)
UPDATE public.eeg_lab_jobs
   SET review_status = 'published',
       grandfathered = TRUE,
       published_at  = COALESCE(published_at, created_at, NOW()),
       expires_at    = NULL
 WHERE stage = 'export'
   AND review_status = 'draft'
   AND created_at < NOW();

-- ---------- publish gate ----------
-- A recording may only become 'published' when the export finished, it has a
-- title, and an editor other than its author reviewed it (four eyes; skipped
-- for AI recordings, which have no author). Grandfathered rows pass untouched
-- until a real review clears the flag, at which point the full gate applies.
-- Publishing also clears expires_at: the library never expires.
CREATE OR REPLACE FUNCTION public.eeg_lab_jobs_publish_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_missing TEXT[] := '{}';
BEGIN
  IF NEW.review_status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF NEW.grandfathered THEN
    NEW.expires_at := NULL;
    RETURN NEW;
  END IF;
  -- already properly published; an unrelated update must not re-litigate it
  IF TG_OP = 'UPDATE' AND OLD.review_status = 'published' AND NOT OLD.grandfathered THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'done' THEN
    v_missing := array_append(v_missing, 'a finished export (the job is not done)');
  END IF;
  IF NEW.title IS NULL OR btrim(NEW.title) = '' THEN
    v_missing := array_append(v_missing, 'a title');
  END IF;
  IF NEW.reviewed_by IS NULL THEN
    v_missing := array_append(v_missing, 'an editor review (reviewed_by is empty)');
  ELSIF NEW.author_id IS NOT NULL AND NEW.reviewed_by = NEW.author_id THEN
    v_missing := array_append(v_missing, 'a review by someone other than its author (four-eyes rule)');
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot publish this recording: it still needs %.',
      array_to_string(v_missing, '; ');
  END IF;

  NEW.published_at := COALESCE(NEW.published_at, NOW());
  NEW.expires_at   := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eeg_lab_jobs_publish_gate ON public.eeg_lab_jobs;
CREATE TRIGGER eeg_lab_jobs_publish_gate
  BEFORE INSERT OR UPDATE ON public.eeg_lab_jobs
  FOR EACH ROW EXECUTE FUNCTION public.eeg_lab_jobs_publish_gate();
