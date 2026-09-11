-- Let an admin clear the AI generation log shown on /admin/qbank.
--
-- Clearing HIDES a job rather than deleting it: a drafted job holds the
-- retrieval corpus that grounded the original draft, and "Revise with AI"
-- re-feeds that corpus to the model so the numbers-sourced and references
-- checks can run. Deleting the row would silently weaken every later revision
-- of that item, so the log is soft-cleared.

ALTER TABLE public.eeg_case_generation_jobs
  ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleared_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS eeg_case_generation_jobs_visible_idx
  ON public.eeg_case_generation_jobs (created_at DESC)
  WHERE cleared_at IS NULL;
