-- ============================================================
-- Events + email-gated registration
-- Migration: 20260902_events
--
-- `events` backs the public /events page and the /admin/events console, so
-- admins can add or edit an event without a code change. Join links and
-- passcodes live in this table but are stripped in `toPublicEvent()` — the
-- public page never receives them; /api/events/register hands them back only
-- after an email is recorded.
--
-- RLS: public SELECT is limited to published rows; all writes go through the
-- service-role client behind `requireAdmin()`.
--
-- Idempotent, and the seed re-runs safely (ON CONFLICT on slug).
-- ============================================================

CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  series TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  host TEXT NOT NULL,
  host_url TEXT,
  host_logo TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'ET',
  format TEXT NOT NULL DEFAULT 'virtual' CHECK (format IN ('virtual', 'in_person', 'hybrid')),
  location TEXT,
  talks JSONB NOT NULL DEFAULT '[]'::jsonb,
  registration TEXT NOT NULL DEFAULT 'none' CHECK (registration IN ('email', 'external', 'none')),
  registration_url TEXT,
  registration_note TEXT,
  join_url TEXT,
  meeting_id TEXT,
  passcode TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS events_starts_at_idx ON events (starts_at DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Note: the anon-visible columns still include join_url, so the app reads
-- events through the service-role client and strips them. This policy exists so
-- a stray anon read can't see drafts.
DROP POLICY IF EXISTS "Anyone can read published events" ON events;
CREATE POLICY "Anyone can read published events"
  ON events FOR SELECT
  USING (status = 'published');

-- ============================================================
-- Event registrations (from the /events email gate)
--
-- One row per email per event. /api/events/register inserts through the
-- service-role client and treats a unique violation as success — the person
-- just wants the join link again — so the unique index is load-bearing.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_registrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_slug TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  institution TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_email_idx
  ON event_registrations (event_slug, lower(email));

ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only service role can read event registrations" ON event_registrations;
CREATE POLICY "Only service role can read event registrations"
  ON event_registrations FOR SELECT
  USING (false);

-- ============================================================
-- Seed: the PNCRG MNM lecture series
-- ============================================================

INSERT INTO events (slug, series, title, summary, host, host_url, host_logo,
                    starts_at, ends_at, timezone, format, location, talks,
                    registration, registration_url, registration_note,
                    join_url, meeting_id, passcode, status)
VALUES
  (
    'mnm-lecture-1',
    'MNM Lecture 1',
    'Current EEG Monitoring Guidelines Across Subpopulations',
    NULL,
    'PNCRG · Multimodal Neuromonitoring Subgroup',
    'https://www.pncrg.org/',
    '/images/events/pncrg-logo.png',
    '2026-06-30T14:00:00-04:00',
    '2026-06-30T16:00:00-04:00',
    'ET', 'virtual', 'Zoom',
    '[
      {"presenter":"Dr. Nick Abend","institution":"Children''s Hospital of Philadelphia","title":"ACNS Guidelines for EEG Monitoring in the Pediatric Critical Care Patient"},
      {"presenter":"Dr. Adam Numis","institution":"UCSF Benioff Children''s Hospitals","title":"ACNS Guidelines for EEG Monitoring in Neonates"},
      {"presenter":"Dr. Alexis Topjian","institution":"Children''s Hospital of Philadelphia","title":"EEG Monitoring in the Post-Cardiac Arrest Patient"},
      {"presenter":"Dr. Brian Appavu","institution":"HonorHealth","title":"EEG Monitoring in the Severe TBI Patient"},
      {"presenter":"Dr. Agnes Kielian","institution":"Boston Children''s Hospital","title":"EEG Monitoring in the Post-Cardiac Surgery Patient"},
      {"presenter":"Dr. Giulia Benedetti","institution":"C.S. Mott Children''s Hospital","title":"EEG Monitoring in the ECMO Patient"}
    ]'::jsonb,
    'none', NULL, NULL, NULL, NULL, NULL, 'published'
  ),
  (
    'mnm-lecture-2',
    'MNM Lecture 2',
    'Barriers to EEG Implementation in Critical Care',
    NULL,
    'PNCRG · Multimodal Neuromonitoring Subgroup',
    'https://www.pncrg.org/',
    '/images/events/pncrg-logo.png',
    '2026-08-25T14:00:00-04:00',
    '2026-08-25T16:00:00-04:00',
    'ET', 'virtual', 'Zoom',
    '[
      {"presenter":"Dr. Cecil Hahn","title":"Establishment, Growth and Sustainability of a Canadian Paediatric Critical Care EEG Service"},
      {"presenter":"Dr. Barney Scholefield","title":"If You Can Run, You Can Walk — Barriers to (Continuous) EEG Implementation in Paediatric Critical Care"},
      {"presenter":"Dr. Hiba Haider","title":"Epilepsy Workforce and Concerns for Physician Burnout"},
      {"presenter":"Dr. Janette Mailo","title":"EEG Utilization and Unique Considerations Across Health Care Systems"},
      {"presenter":"Ms. Ashley Kilday and Ms. Stephanie Quigley","title":"Beyond the Electrodes: Building and Sustaining EEG in Critical Care"}
    ]'::jsonb,
    'none', NULL, NULL, NULL, NULL, NULL, 'published'
  ),
  (
    'mnm-lecture-3',
    'MNM Lecture 3',
    'Emerging EEG Technologies and Solutions',
    'An afternoon on the evolving role of EEG technology in pediatric neurocritical care — cEEG, qEEG, multimodal data, point-of-care EEG, and machine learning.',
    'PNCRG · Multimodal Neuromonitoring Subgroup',
    'https://www.pncrg.org/',
    '/images/events/pncrg-logo.png',
    '2026-09-03T14:00:00-04:00',
    '2026-09-03T16:00:00-04:00',
    'ET', 'virtual', 'Zoom',
    '[
      {"presenter":"Dr. Mark Scheuer","title":"Brain Function Monitoring Using cEEG and Persyst qEEG Trending/Algorithms"},
      {"presenter":"Mr. Ethan Moyer","title":"From Multimodal Data to Clinical Intelligence in Pediatric Neurocritical Care"},
      {"presenter":"Dr. Rej Guerriero","title":"qEEG: Utility and Challenges in Clinical Practice"},
      {"presenter":"Dr. Neil Munjal","title":"Institutional Experience with the Zeto POC EEG Device and Implementation of Nurse-Led qEEG in the PICU"},
      {"presenter":"Dr. Robert van den Berg","title":"Machine Learning for qEEG: New Tools for Monitoring and Prediction"}
    ]'::jsonb,
    'email', NULL,
    'Free and open to anyone caring for or researching critically ill children. Enter your email and we''ll send you the Zoom link.',
    'https://us06web.zoom.us/j/82442914024?pwd=e0pvcUOWTas6txZKVbmf4XnVA2fsut.1',
    '824 4291 4024',
    '457059',
    'published'
  ),
  (
    'mnm-lecture-4',
    'MNM Lecture 4',
    'Save the date — topic to be announced',
    'The fourth and final lecture of the series. Topic, speakers, and the Zoom link will be announced shortly.',
    'PNCRG · Multimodal Neuromonitoring Subgroup',
    'https://www.pncrg.org/',
    '/images/events/pncrg-logo.png',
    '2026-09-17T14:00:00-04:00',
    '2026-09-17T16:00:00-04:00',
    'ET', 'virtual', 'Zoom',
    '[]'::jsonb,
    'none', NULL, NULL, NULL, NULL, NULL, 'published'
  ),
  (
    'pncrg-fall-2026',
    'Series workshop',
    'PNCRG Fall 2026 Meeting — Hybrid MNM Workshop',
    'The lecture series culminates in a hybrid workshop at the PNCRG fall meeting, working toward a consensus publication on practical EEG implementation. In-person and virtual options. Free registration is a benefit of active PNCRG membership; the Neurocritical Care Society meets in Seattle October 20–23 and requires separate registration.',
    'PNCRG',
    'https://www.pncrg.org/',
    '/images/events/pncrg-seattle-2026.png',
    '2026-10-19T09:00:00-07:00',
    '2026-10-20T17:00:00-07:00',
    'PT', 'hybrid', 'Seattle, Washington',
    '[]'::jsonb,
    'external',
    'https://www.pncrg.org/become-a-member/',
    'Become a PNCRG member to attend.',
    NULL, NULL, NULL, 'published'
  )
ON CONFLICT (slug) DO NOTHING;
