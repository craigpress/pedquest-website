-- ============================================================
-- qEEG "Case of the Day" — daily EEG/qEEG image + quiz feature
-- Migration: 20260714_eeg_cases
-- Idempotent. Apply via Supabase SQL Editor (or CLI).
--
-- SECURITY MODEL (deliberate):
--   * eeg_cases: public may SELECT only PUBLISHED cases whose
--     publish_date has arrived. All writes are service-role only.
--   * eeg_case_options: NO public SELECT — the correct answer must
--     never reach the client before the user responds. All reads go
--     through server code using the service-role key.
--   * eeg_responses: NO public access at all. Responses are written
--     and read only by server API routes (service role), which grade
--     the answer server-side so is_correct cannot be spoofed.
-- ============================================================

-- ---------- cases ----------
CREATE TABLE IF NOT EXISTS eeg_cases (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  publish_date      DATE,                                   -- day it becomes "case of the day"
  title             TEXT NOT NULL,
  clinical_vignette TEXT,                                   -- de-identified patient context
  image_url         TEXT NOT NULL DEFAULT '',               -- public image (Supabase storage or /images)
  image_width       INTEGER,
  image_height      INTEGER,
  question_type     TEXT NOT NULL DEFAULT 'multiple_choice'
                      CHECK (question_type IN ('multiple_choice','point_to_feature')),
  question_prompt   TEXT NOT NULL,
  explanation       TEXT,                                   -- shown after answering
  teaching_points   TEXT[] DEFAULT '{}',
  correct_region    JSONB,                                  -- point_to_feature target (normalised 0..1)
  region_tolerance  NUMERIC,                                -- optional expansion of the target
  difficulty        TEXT DEFAULT 'intermediate'
                      CHECK (difficulty IN ('introductory','intermediate','advanced')),
  tags              TEXT[] DEFAULT '{}',
  source            TEXT NOT NULL DEFAULT 'team' CHECK (source IN ('team','ai')),
  ai_source_url     TEXT,                                   -- reference the AI cited
  ai_model          TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending_review','approved','published','archived')),
  created_by        UUID,
  reviewed_by       UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eeg_cases_publish_idx ON eeg_cases (publish_date DESC);
CREATE INDEX IF NOT EXISTS eeg_cases_status_idx  ON eeg_cases (status);
CREATE INDEX IF NOT EXISTS eeg_cases_tags_idx    ON eeg_cases USING GIN (tags);

-- ---------- multiple-choice options ----------
CREATE TABLE IF NOT EXISTS eeg_case_options (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id            UUID NOT NULL REFERENCES eeg_cases(id) ON DELETE CASCADE,
  label              TEXT NOT NULL,
  is_correct         BOOLEAN NOT NULL DEFAULT FALSE,
  option_explanation TEXT,
  sort_order         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_options_case_idx ON eeg_case_options (case_id);

-- ---------- member / anonymous responses ----------
CREATE TABLE IF NOT EXISTS eeg_responses (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id            UUID NOT NULL REFERENCES eeg_cases(id) ON DELETE CASCADE,
  user_id            UUID,                 -- set when a signed-in member answers
  session_id         TEXT,                 -- anonymous browser session otherwise
  member_email       TEXT,                 -- denormalised for admin analytics (members only)
  selected_option_id UUID REFERENCES eeg_case_options(id) ON DELETE SET NULL,
  pointed_x          NUMERIC,              -- normalised 0..1 (point_to_feature)
  pointed_y          NUMERIC,
  is_correct         BOOLEAN,
  responded_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_responses_case_idx ON eeg_responses (case_id);
-- one response per member per case, and one per anonymous session per case
CREATE UNIQUE INDEX IF NOT EXISTS eeg_responses_case_user_uniq
  ON eeg_responses (case_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eeg_responses_case_session_uniq
  ON eeg_responses (case_id, session_id) WHERE user_id IS NULL AND session_id IS NOT NULL;

-- ---------- updated_at triggers (reuse shared fn from schema.sql) ----------
DROP TRIGGER IF EXISTS eeg_cases_updated_at ON eeg_cases;
CREATE TRIGGER eeg_cases_updated_at BEFORE UPDATE ON eeg_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row-Level Security
-- ============================================================
ALTER TABLE eeg_cases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE eeg_case_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE eeg_responses    ENABLE ROW LEVEL SECURITY;

-- cases: public can read only live published cases; writes are service-role only
DROP POLICY IF EXISTS "Published cases are viewable by everyone" ON eeg_cases;
CREATE POLICY "Published cases are viewable by everyone" ON eeg_cases
  FOR SELECT USING (status = 'published' AND (publish_date IS NULL OR publish_date <= CURRENT_DATE));
-- (no INSERT/UPDATE/DELETE policy → denied for anon/authenticated; service role bypasses RLS)

-- options: never exposed to the client (would leak the answer). Server reads via service role.
DROP POLICY IF EXISTS "Options are not publicly readable" ON eeg_case_options;
CREATE POLICY "Options are not publicly readable" ON eeg_case_options
  FOR SELECT USING (false); -- server-only; service role bypasses RLS

-- responses: fully private. Written and read only by server API routes (service role).
DROP POLICY IF EXISTS "Responses are not publicly readable" ON eeg_responses;
CREATE POLICY "Responses are not publicly readable" ON eeg_responses
  FOR SELECT USING (false);

-- ============================================================
-- Storage bucket for case images (public read, service-role write)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('eeg-cases', 'eeg-cases', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "eeg-case images are public" ON storage.objects;
CREATE POLICY "eeg-case images are public" ON storage.objects
  FOR SELECT USING (bucket_id = 'eeg-cases');
-- uploads happen through the admin API using the service role (no public INSERT policy)

-- ============================================================
-- Seed: two synthetic demo cases (NO patient data — drawn signals)
-- ============================================================
INSERT INTO eeg_cases (id, publish_date, title, clinical_vignette, image_url,
    question_type, question_prompt, explanation, teaching_points, correct_region,
    difficulty, tags, source, status)
VALUES
(
  '00000000-0000-4000-a000-000000000001',
  CURRENT_DATE,
  'Focal slowing on a routine PICU montage',
  'A 6-year-old is monitored after a prolonged febrile illness. This 10-second, 8-channel synthetic tracing is provided for teaching.',
  '/images/eeg-cases/sample-asymmetry.svg',
  'multiple_choice',
  'What is the most prominent finding in this tracing?',
  'The left-hemisphere channels (top four) show higher-amplitude, slower (delta-range) activity than the right, i.e. a focal interhemispheric asymmetry with left-sided slowing — a classic pointer toward a focal structural or functional disturbance on the left.',
  ARRAY[
    'Interhemispheric amplitude/frequency asymmetry is one of the most reliable qEEG red flags.',
    'Left > right slowing localises rather than lateralises — always correlate with the montage and clinical context.',
    'Attenuation on one side can reflect cortical injury, fluid collection, or electrode issues — rule out technical causes first.'
  ],
  NULL,
  'intermediate',
  ARRAY['asymmetry','focal slowing','fundamentals'],
  'team', 'published'
),
(
  '00000000-0000-4000-a000-000000000002',
  CURRENT_DATE - 1,
  'Point to the electrographic seizure onset',
  'Continuous EEG in a comatose child after cardiac arrest. This synthetic 8-channel tracing shows an evolving rhythmic discharge for teaching.',
  '/images/eeg-cases/sample-seizure.svg',
  'point_to_feature',
  'Click the point where the rhythmic, evolving electrographic seizure begins.',
  'A well-defined region of rhythmic, evolving activity (increasing frequency and amplitude) emerges in the right-central time window — the electrographic seizure onset. Marking its leading edge is the key skill.',
  ARRAY[
    'Electrographic seizures are defined by evolution — in frequency, amplitude, or spatial spread — not by a single sharp transient.',
    'Identifying onset (the leading edge) matters more than the middle of the discharge for localisation.',
    'On compressed qEEG trends the same event appears as a rising "flame" on the spectrogram / colour density array.'
  ],
  '{"kind":"rect","x":0.52,"y":0.04,"w":0.20,"h":0.92}'::jsonb,
  0.03,
  'advanced',
  ARRAY['seizure','onset','continuous EEG'],
  'team', 'published'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO eeg_case_options (case_id, label, is_correct, option_explanation, sort_order)
VALUES
 ('00000000-0000-4000-a000-000000000001','Left-hemisphere focal slowing / asymmetry', TRUE,  'Correct — the top (left) channels are higher-amplitude and slower than the bottom (right) channels.', 0),
 ('00000000-0000-4000-a000-000000000001','Generalised periodic discharges',           FALSE, 'Not shown — there is no periodic, generalised, stereotyped complex here.', 1),
 ('00000000-0000-4000-a000-000000000001','Diffuse background suppression',             FALSE, 'Not shown — amplitudes are preserved, and one side is clearly higher.', 2),
 ('00000000-0000-4000-a000-000000000001','Normal, symmetric background',               FALSE, 'Incorrect — compare the two hemispheres: they are clearly asymmetric.', 3)
ON CONFLICT DO NOTHING;
