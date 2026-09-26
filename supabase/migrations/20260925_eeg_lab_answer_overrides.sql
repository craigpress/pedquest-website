-- Editor corrections to rendered EEG Lab answer keys.
-- The rendered answers artifact remains immutable. Each row is an append-only
-- audit event; the application folds rows over the original manifest.

ALTER TABLE public.eeg_lab_jobs
  ADD COLUMN IF NOT EXISTS answer_generation UUID NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS public.eeg_lab_answer_overrides (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id                UUID NOT NULL REFERENCES public.eeg_lab_jobs(id) ON DELETE CASCADE,
  event_id              TEXT,
  action                TEXT NOT NULL CHECK (action IN ('add','update','remove','reset')),
  event                 JSONB,
  note                  TEXT NOT NULL DEFAULT '',
  base_answers_path     TEXT NOT NULL,
  base_generation      UUID NOT NULL,
  edited_by             UUID NOT NULL,
  edited_by_email       TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (action = 'reset' AND event_id IS NULL AND event IS NULL)
    OR
    (action = 'remove' AND event_id IS NOT NULL AND event IS NULL)
    OR
    (action IN ('add','update') AND event_id IS NOT NULL AND event IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS eeg_lab_answer_overrides_job_history_idx
  ON public.eeg_lab_answer_overrides (job_id, created_at, id);

ALTER TABLE public.eeg_lab_answer_overrides ENABLE ROW LEVEL SECURITY;

-- Routes use the service role and enforce editor-only writes. Editors may
-- inspect the append-only audit trail directly; no client role may mutate it.
DROP POLICY IF EXISTS eeg_lab_answer_overrides_editor_read ON public.eeg_lab_answer_overrides;
CREATE POLICY eeg_lab_answer_overrides_editor_read ON public.eeg_lab_answer_overrides
  FOR SELECT USING (public.is_pedquest_editor());

-- A re-render may overwrite the same artifact path. Rotate an explicit
-- generation whenever a completed answer artifact is replaced or a job
-- returns to done, so old overrides cannot leak into the fresh manifest.
CREATE OR REPLACE FUNCTION public.rotate_eeg_lab_answer_generation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.artifacts ->> 'answers') IS DISTINCT FROM (OLD.artifacts ->> 'answers')
     OR (NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done') THEN
    NEW.answer_generation := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eeg_lab_jobs_answer_generation ON public.eeg_lab_jobs;
CREATE TRIGGER eeg_lab_jobs_answer_generation
  BEFORE UPDATE ON public.eeg_lab_jobs
  FOR EACH ROW EXECUTE FUNCTION public.rotate_eeg_lab_answer_generation();
