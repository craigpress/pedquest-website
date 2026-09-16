-- 2026-09-16: a trend-pane mark records how many seconds were visible across the
-- trend strip when it was placed (the zoom window, or the whole record). The
-- scoring in src/lib/lab/scoring.ts turns that into a time tolerance: a click
-- on a 24 h strip cannot be as precise as one on a 10 s raw page. NULL for raw
-- marks and for rows written before this column existed (scoring falls back to
-- the recording length).
ALTER TABLE public.eeg_lab_annotations
  ADD COLUMN IF NOT EXISTS view_span_s REAL;

ALTER TABLE public.eeg_lab_annotations DROP CONSTRAINT IF EXISTS eeg_lab_annotations_view_span_check;
ALTER TABLE public.eeg_lab_annotations
  ADD CONSTRAINT eeg_lab_annotations_view_span_check CHECK (view_span_s IS NULL OR view_span_s > 0);
