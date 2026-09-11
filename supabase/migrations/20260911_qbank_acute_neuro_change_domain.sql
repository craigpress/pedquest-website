-- New question-bank domain: acute_neuro_change.
--
-- Stroke, hemorrhage, rising ICP, vasospasm and other new neurologic changes
-- read off the trends. `background_terminology` is about naming what the
-- record looks like and `clinical_prognosis` about outcome evidence; noticing
-- that the record has CHANGED is a different skill and was landing in both.

ALTER TABLE public.eeg_cases DROP CONSTRAINT IF EXISTS eeg_cases_domain_chk;
ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_domain_chk CHECK (
  domain IS NULL OR domain = ANY (ARRAY[
    'foundations','seizure_detection','background_terminology','acute_neuro_change',
    'clinical_prognosis','monitoring_practice','special_populations_pitfalls'
  ])
);
