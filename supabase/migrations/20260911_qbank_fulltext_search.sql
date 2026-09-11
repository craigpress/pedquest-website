-- 2026-09-11  Full-text search over question content.
--
-- Before this, the learner question bank had no text search at all (four
-- dropdown filters only) and the editor queue matched title, qbank_id and tag
-- on the already-loaded page. Neither searched the vignette, lead-in,
-- explanation, key points, references or — the one people actually reach for —
-- the answer options and their rationales.
--
-- Option text lives in a child table, so a GENERATED column cannot see it.
-- A denormalised `search_text` column is maintained by triggers on both
-- tables instead, and indexed with GIN over to_tsvector.

ALTER TABLE public.eeg_cases ADD COLUMN IF NOT EXISTS search_text TEXT;

CREATE OR REPLACE FUNCTION public.qbank_search_text(p_case_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT concat_ws(' ',
    c.qbank_id, c.title, c.lead_in, c.clinical_vignette, c.question_prompt,
    c.explanation, c.image_caption,
    array_to_string(coalesce(c.key_points, '{}'), ' '),
    array_to_string(coalesce(c.teaching_points, '{}'), ' '),
    array_to_string(coalesce(c.tags, '{}'), ' '),
    c.domain, c.population, c.setting, c.difficulty, c.bloom, c.learning_objective,
    (SELECT string_agg(concat_ws(' ', o.label, o.option_explanation), ' ')
       FROM public.eeg_case_options o WHERE o.case_id = c.id),
    (SELECT string_agg(concat_ws(' ', r.citation, r.pmid, r.doi), ' ')
       FROM public.eeg_case_references r WHERE r.case_id = c.id)
  )
  FROM public.eeg_cases c WHERE c.id = p_case_id;
$$;

CREATE OR REPLACE FUNCTION public.qbank_refresh_search_text()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target UUID;
BEGIN
  -- IF/ELSIF, not a SQL CASE. PL/pgSQL resolves record fields when it PLANS
  -- the expression, not when the branch is taken, so a CASE mentioning
  -- NEW.case_id aborts every write to eeg_cases (which has no such column)
  -- with: record "new" has no field "case_id".
  IF TG_TABLE_NAME = 'eeg_cases' THEN
    target := COALESCE(NEW.id, OLD.id);
  ELSE
    target := COALESCE(NEW.case_id, OLD.case_id);
  END IF;

  IF target IS NOT NULL THEN
    UPDATE public.eeg_cases
       SET search_text = public.qbank_search_text(target)
     WHERE id = target;
  END IF;
  RETURN NULL;
END;
$$;

-- AFTER + STATEMENT-less row triggers: the function re-reads the row, so it
-- must run after the write lands. The eeg_cases trigger deliberately excludes
-- search_text from its own UPDATE column list to avoid recursing.
DROP TRIGGER IF EXISTS eeg_cases_search_text ON public.eeg_cases;
CREATE TRIGGER eeg_cases_search_text
  AFTER INSERT OR UPDATE OF qbank_id, title, lead_in, clinical_vignette, question_prompt,
    explanation, image_caption, key_points, teaching_points, tags, domain, population,
    setting, difficulty, bloom, learning_objective
  ON public.eeg_cases
  FOR EACH ROW EXECUTE FUNCTION public.qbank_refresh_search_text();

DROP TRIGGER IF EXISTS eeg_case_options_search_text ON public.eeg_case_options;
CREATE TRIGGER eeg_case_options_search_text
  AFTER INSERT OR UPDATE OR DELETE ON public.eeg_case_options
  FOR EACH ROW EXECUTE FUNCTION public.qbank_refresh_search_text();

DROP TRIGGER IF EXISTS eeg_case_references_search_text ON public.eeg_case_references;
CREATE TRIGGER eeg_case_references_search_text
  AFTER INSERT OR UPDATE OR DELETE ON public.eeg_case_references
  FOR EACH ROW EXECUTE FUNCTION public.qbank_refresh_search_text();

CREATE INDEX IF NOT EXISTS eeg_cases_search_idx
  ON public.eeg_cases USING GIN (to_tsvector('english', coalesce(search_text, '')));

-- backfill
UPDATE public.eeg_cases SET search_text = public.qbank_search_text(id);

-- A real tsvector column so PostgREST .textSearch() hits the index directly.
ALTER TABLE public.eeg_cases
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;

DROP INDEX IF EXISTS public.eeg_cases_search_idx;
CREATE INDEX IF NOT EXISTS eeg_cases_search_tsv_idx ON public.eeg_cases USING GIN (search_tsv);
