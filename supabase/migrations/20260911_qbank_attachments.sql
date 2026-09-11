-- 2026-09-11  Editor-supplied source material for question generation.
--
-- An editor writing a prompt often has the thing they want in front of them:
-- a PDF of the paper the item should be grounded on, or a figure from a talk
-- with "make a synthetic version of this". Until now neither could reach the
-- generator, so the model worked only from a PubMed topic search.
--
-- IMPORTANT: an uploaded image is REFERENCE material only. It is never the
-- published case image - the renderer still draws an original synthetic
-- figure from the spec. That keeps the bank free of third-party figure
-- copyright, which docs/CASE_IMAGE_SOURCING_POLICY.md requires.

CREATE TABLE IF NOT EXISTS public.eeg_case_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- an attachment belongs to a prompt before any case row exists, so both
  -- links are nullable and filled in as the pipeline progresses
  job_id        UUID REFERENCES public.eeg_case_generation_jobs(id) ON DELETE CASCADE,
  case_id       UUID REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  /** upload token that ties files to a prompt before the job row exists */
  batch         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('pdf', 'image')),
  filename      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     INTEGER NOT NULL CHECK (byte_size > 0),
  storage_path  TEXT NOT NULL,
  /** PDF only: text pulled out at upload time and fed to the model as evidence */
  extracted_text TEXT,
  /** how the editor wants it used, e.g. "make a synthetic version of this" */
  note          TEXT,
  uploaded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eeg_case_attachments_batch_idx ON public.eeg_case_attachments (batch);
CREATE INDEX IF NOT EXISTS eeg_case_attachments_job_idx   ON public.eeg_case_attachments (job_id);
CREATE INDEX IF NOT EXISTS eeg_case_attachments_case_idx  ON public.eeg_case_attachments (case_id);

ALTER TABLE public.eeg_case_attachments ENABLE ROW LEVEL SECURITY;

-- Source material is editorial, never learner-facing: no public policy at all.
DROP POLICY IF EXISTS "Editors can read attachments" ON public.eeg_case_attachments;
CREATE POLICY "Editors can read attachments" ON public.eeg_case_attachments
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can insert attachments" ON public.eeg_case_attachments;
CREATE POLICY "Editors can insert attachments" ON public.eeg_case_attachments
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can update attachments" ON public.eeg_case_attachments;
CREATE POLICY "Editors can update attachments" ON public.eeg_case_attachments
  FOR UPDATE USING (public.is_pedquest_editor()) WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Admins can delete attachments" ON public.eeg_case_attachments;
CREATE POLICY "Admins can delete attachments" ON public.eeg_case_attachments
  FOR DELETE USING (public.is_pedquest_admin());
