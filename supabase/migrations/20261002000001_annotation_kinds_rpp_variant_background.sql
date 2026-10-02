-- 2026-10-02: learner kinds for the answer-key categories that had none, so every gradable category has a
-- scoring task (src/lib/lab/scoring.ts MARK_TASKS): rhythmic_periodic (ACNS RPP / IIC / BIRDs that are not a
-- seizure), normal_variant, background_change. Mirrors ANNOTATION_KINDS in src/lib/eeg/annotations.ts.
-- Widening only: every existing row still passes.
ALTER TABLE public.eeg_lab_annotations DROP CONSTRAINT IF EXISTS eeg_lab_annotations_kind_check;
ALTER TABLE public.eeg_lab_annotations
  ADD CONSTRAINT eeg_lab_annotations_kind_check
  CHECK (kind IN ('seizure','seizure_onset','discharge','rhythmic_periodic','normal_variant','background_change',
                  'artifact','state_change','medication','note'));
