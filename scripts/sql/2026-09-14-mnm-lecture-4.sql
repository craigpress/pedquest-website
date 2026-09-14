-- MNM Lecture 4 details (2026-09-14). The seed in 20260902_events.sql is
-- ON CONFLICT DO NOTHING, so the placeholder row has to be UPDATEd in place.
-- Applied to production 2026-09-14 through the service-role client (one-off
-- supabase-js update with these same values); kept here so the SQL editor
-- path works too. Idempotent.
-- memberId links a presenter to their /members/{id} page (added same day).

UPDATE public.events SET
  title = 'Implementation Science in ICU EEG Monitoring',
  summary = 'The fourth and final lecture of the series: curriculum development, quality improvement, risk-based EEG utilization, and process change in pediatric status epilepticus. The remaining time will be spent discussing topics for the small-group sessions at October''s in-person PNCRG meeting.',
  talks = '[
    {"presenter":"Dr. Laura Caligiuri","memberId":"laura-caligiuri","title":"Development of a QEEG Curriculum for PNCC Trainees"},
    {"presenter":"Dr. Lindsey Morgan","memberId":"lindsey-morgan","title":"Quality Improvement in Pediatric Neurology: Cutting Time to EEG in Half"},
    {"presenter":"Dr. France Fung","title":"Who Should We Monitor, and for How Long? Toward Risk-Based EEG Utilization in the PICU"},
    {"presenter":"Dr. Adam Ostendorf","memberId":"adam-ostendorf","title":"Studying Process Change in Pediatric Status Epilepticus — Lessons Learned from QuITT-SE"}
  ]'::jsonb,
  registration = 'email',
  registration_note = 'Free and open to anyone caring for or researching critically ill children. Enter your email and we''ll send you the Zoom link.',
  join_url = 'https://us06web.zoom.us/j/85435144655?pwd=bgGtOY3Map3ifRMdp5grZpqgLzrRXs.1',
  meeting_id = '854 3514 4655',
  passcode = '563262',
  status = 'published',
  updated_at = now()
WHERE slug = 'mnm-lecture-4';

SELECT slug, title, registration, meeting_id, jsonb_array_length(talks) AS talks FROM public.events WHERE slug = 'mnm-lecture-4';
