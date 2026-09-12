-- EEG Teaching Lab: viewer annotations, one row per mark per user.
--
-- A learner's marks on a lab recording. Private to the author by default,
-- readable by editors (instructors) so a learner's onsets can be compared to
-- the answer key. The recording itself is never rewritten: annotations live
-- here and are merged into a per-user .lay copy on export.

CREATE TABLE IF NOT EXISTS public.eeg_lab_annotations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id      UUID NOT NULL REFERENCES public.eeg_lab_jobs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  user_email  TEXT NOT NULL,
  onset_s     DOUBLE PRECISION NOT NULL CHECK (onset_s >= 0),
  duration_s  DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (duration_s >= 0),
  kind        TEXT NOT NULL
                CHECK (kind IN ('seizure','seizure_onset','artifact','state_change','medication','note')),
  label       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eeg_lab_annotations_job_idx
  ON public.eeg_lab_annotations (job_id, user_id, onset_s);

DROP TRIGGER IF EXISTS eeg_lab_annotations_updated_at ON public.eeg_lab_annotations;
CREATE TRIGGER eeg_lab_annotations_updated_at BEFORE UPDATE ON public.eeg_lab_annotations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- RLS mirrors the route policy: authors own their rows; editors read all.
-- The API routes use the service role and enforce the same rules in code.
ALTER TABLE public.eeg_lab_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eeg_lab_annotations_own ON public.eeg_lab_annotations;
CREATE POLICY eeg_lab_annotations_own ON public.eeg_lab_annotations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS eeg_lab_annotations_editor_read ON public.eeg_lab_annotations;
CREATE POLICY eeg_lab_annotations_editor_read ON public.eeg_lab_annotations
  FOR SELECT USING (public.is_pedquest_editor());
