-- ============================================================
-- PedQuEST qEEG Question Bank — roles, bank fields, review trail
-- Migration: 20260903_qbank
--
-- ADDITIVE and IDEMPOTENT. Nothing is dropped or renamed; the existing
-- Case-of-the-Day tables (eeg_cases / eeg_case_options / eeg_responses /
-- eeg_case_image_jobs) keep working unchanged.
--
-- What this adds
--   1. public.user_roles          — member / editor / admin, replaces the
--                                   hardcoded email allowlist in three places.
--   2. eeg_cases bank columns     — qbank_id, domain/population/setting/bloom,
--                                   lead_in, key_points, content/spec snapshots.
--   3. Companion tables           — references, revisions, reviews, generation
--                                   jobs, render jobs.
--   4. Publish gate               — a case cannot reach 'approved'/'published'
--                                   without a license, a verified reference and
--                                   a second pair of eyes.
--   5. RLS                        — public reads published items only; editors
--                                   read/edit the pipeline; admins own roles.
--
-- Apply via the Supabase SQL editor or `supabase db push`. Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. Roles
-- ============================================================

-- email is the primary key because authorization has to work from the JWT's
-- email claim: the Authentik bridge mints a Supabase user lazily, so a role
-- can be granted before that user_id exists. user_id is backfilled on login.
CREATE TABLE IF NOT EXISTS public.user_roles (
  email       TEXT PRIMARY KEY,
  user_id     UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('member','editor','admin')),
  granted_by  UUID,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Keep emails canonical: everything compares against lower(jwt email).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_email_lower_chk') THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_email_lower_chk CHECK (email = lower(email));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles (role);

DROP TRIGGER IF EXISTS user_roles_updated_at ON public.user_roles;
CREATE TRIGGER user_roles_updated_at BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Seed the four emails that were hardcoded in src/lib/admin-auth.ts,
-- src/app/admin/page.tsx and the old is_pedquest_admin() body.
INSERT INTO public.user_roles (email, role) VALUES
  ('pressca@chop.edu',      'admin'),
  ('craigpress@gmail.com',  'admin'),
  ('gbenedet@med.umich.edu','admin'),
  ('ajay.thomas@bcm.edu',   'admin')
ON CONFLICT (email) DO NOTHING;

-- ---------- role predicates ----------
-- SECURITY DEFINER (not INVOKER as before) is required here: user_roles has
-- RLS, and its "admins manage roles" policy calls is_pedquest_admin(). With
-- SECURITY INVOKER that policy would re-enter the table's own policies and
-- Postgres would raise "infinite recursion detected in policy". As DEFINER the
-- function runs as its owner (the table owner), so the lookup skips RLS and
-- the recursion is broken. search_path is still pinned to '' and both
-- functions are STABLE and read-only.
CREATE OR REPLACE FUNCTION public.is_pedquest_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE email = lower(COALESCE(auth.jwt() ->> 'email', ''))
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pedquest_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE email = lower(COALESCE(auth.jwt() ->> 'email', ''))
      AND role IN ('editor','admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_pedquest_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_pedquest_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pedquest_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pedquest_editor() TO anon, authenticated;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own role" ON public.user_roles;
CREATE POLICY "Users can read their own role" ON public.user_roles
  FOR SELECT USING (
    email = lower(COALESCE(auth.jwt() ->> 'email', '')) OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT USING (public.is_pedquest_admin());

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_pedquest_admin());

DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE USING (public.is_pedquest_admin()) WITH CHECK (public.is_pedquest_admin());

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE USING (public.is_pedquest_admin());

-- ============================================================
-- 2. Question-bank columns on eeg_cases
-- ============================================================
ALTER TABLE public.eeg_cases
  ADD COLUMN IF NOT EXISTS qbank_id           TEXT,
  ADD COLUMN IF NOT EXISTS domain             TEXT,
  ADD COLUMN IF NOT EXISTS population         TEXT,
  ADD COLUMN IF NOT EXISTS setting            TEXT,
  ADD COLUMN IF NOT EXISTS bloom              TEXT,
  ADD COLUMN IF NOT EXISTS learning_objective TEXT,
  ADD COLUMN IF NOT EXISTS lead_in            TEXT,
  ADD COLUMN IF NOT EXISTS image_caption      TEXT,
  ADD COLUMN IF NOT EXISTS key_points         TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS version            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content            JSONB,
  ADD COLUMN IF NOT EXISTS spec               JSONB,
  ADD COLUMN IF NOT EXISTS spec_hash          TEXT,
  ADD COLUMN IF NOT EXISTS image_sidecar      JSONB,
  ADD COLUMN IF NOT EXISTS in_bank            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generation_job_id  UUID;

-- qbank_id is the permanent content ID (PQ-A-007); one case per ID.
CREATE UNIQUE INDEX IF NOT EXISTS eeg_cases_qbank_id_uniq
  ON public.eeg_cases (qbank_id) WHERE qbank_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS eeg_cases_domain_idx     ON public.eeg_cases (domain);
CREATE INDEX IF NOT EXISTS eeg_cases_in_bank_idx    ON public.eeg_cases (in_bank, status);
CREATE INDEX IF NOT EXISTS eeg_cases_population_idx ON public.eeg_cases (population);

-- Controlled vocabularies, mirroring content/qbank/schema/question.schema.json.
-- NULL stays legal so the pre-existing Case-of-the-Day rows remain valid.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_domain_chk') THEN
    ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_domain_chk
      CHECK (domain IS NULL OR domain IN (
        'foundations','seizure_detection','background_terminology',
        'clinical_prognosis','monitoring_practice','special_populations_pitfalls'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_population_chk') THEN
    ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_population_chk
      CHECK (population IS NULL OR population IN ('neonate','infant','child','adolescent','mixed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_setting_chk') THEN
    ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_setting_chk
      CHECK (setting IS NULL OR setting IN ('NICU','PICU','CICU','ECMO','ED','EMU','OR','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_bloom_chk') THEN
    ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_bloom_chk
      CHECK (bloom IS NULL OR bloom IN ('recall','interpretation','application','analysis'));
  END IF;
END $$;

-- The bank renders synthetic images from an image.spec; widen the license
-- vocabulary to the values content/qbank/schema/question.schema.json allows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eeg_cases_image_license_chk') THEN
    ALTER TABLE public.eeg_cases DROP CONSTRAINT eeg_cases_image_license_chk;
  END IF;
  ALTER TABLE public.eeg_cases ADD CONSTRAINT eeg_cases_image_license_chk
    CHECK (image_license IS NULL OR image_license IN (
      'consortium','cc0','cc-by','cc-by-sa','cc-by-nc','cc-by-nd',
      'public-domain','ai-original','synthetic-original','dataset-derived'));
END $$;

-- ============================================================
-- 3. Companion tables
-- ============================================================

-- ---------- references (the evidence trail) ----------
CREATE TABLE IF NOT EXISTS public.eeg_case_references (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id       UUID NOT NULL REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  pmid          TEXT,
  doi           TEXT,
  url           TEXT,
  citation      TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'supporting' CHECK (role IN ('primary','supporting')),
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by   TEXT,
  open_access   TEXT CHECK (open_access IS NULL OR open_access IN
                  ('cc-by','cc-by-nc','cc-by-nc-nd','pmc-oa','none','unknown')),
  member_author BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_references_case_idx ON public.eeg_case_references (case_id, sort_order);
CREATE INDEX IF NOT EXISTS eeg_case_references_pmid_idx ON public.eeg_case_references (pmid);

-- ---------- revisions (append-only content history) ----------
CREATE TABLE IF NOT EXISTS public.eeg_case_revisions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id     UUID NOT NULL REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     JSONB,
  changed_by  UUID,
  change_note TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_revisions_case_idx ON public.eeg_case_revisions (case_id, version DESC);

-- ---------- reviews (editor decisions) ----------
CREATE TABLE IF NOT EXISTS public.eeg_case_reviews (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id        UUID NOT NULL REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  reviewer       UUID,
  reviewer_email TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('approved','changes_requested','rejected')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_reviews_case_idx ON public.eeg_case_reviews (case_id, created_at DESC);

-- ---------- generation jobs (retrieval → draft → critic) ----------
CREATE TABLE IF NOT EXISTS public.eeg_case_generation_jobs (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain         TEXT,
  topic          TEXT,
  model          TEXT,
  prompt_version TEXT,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','drafted','failed')),
  retrieval      JSONB,
  draft          JSONB,
  critic_report  JSONB,
  case_id        UUID REFERENCES public.eeg_cases(id) ON DELETE SET NULL,
  error          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_generation_jobs_status_idx
  ON public.eeg_case_generation_jobs (status, created_at DESC);

DROP TRIGGER IF EXISTS eeg_case_generation_jobs_updated_at ON public.eeg_case_generation_jobs;
CREATE TRIGGER eeg_case_generation_jobs_updated_at BEFORE UPDATE ON public.eeg_case_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------- render jobs ----------
-- CONTRACT: tools/eeg-render's Python worker polls this table. Do not rename
-- these columns. It claims a row (status pending -> running), renders from
-- `spec`, writes `image_url` + `sidecar` (answer region + provenance) and sets
-- status 'done', or writes `error` and status 'error'.
CREATE TABLE IF NOT EXISTS public.eeg_case_render_jobs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id    UUID REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  spec       JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','done','error')),
  image_url  TEXT,
  sidecar    JSONB,
  error      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_case_render_jobs_status_idx
  ON public.eeg_case_render_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS eeg_case_render_jobs_case_idx
  ON public.eeg_case_render_jobs (case_id, created_at DESC);

DROP TRIGGER IF EXISTS eeg_case_render_jobs_updated_at ON public.eeg_case_render_jobs;
CREATE TRIGGER eeg_case_render_jobs_updated_at BEFORE UPDATE ON public.eeg_case_render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 4. Publish gate + revision trail
-- ============================================================

-- A case may only move to 'approved' or 'published' when
--   * image_license is set (docs/CASE_IMAGE_SOURCING_POLICY.md), and
--   * at least one eeg_case_references row is verified, and
--   * reviewed_by is set and differs from created_by (four eyes).
-- The exception message is written to be shown verbatim in the editor console.
CREATE OR REPLACE FUNCTION public.eeg_cases_publish_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_missing TEXT[] := '{}';
  v_verified_refs INTEGER := 0;
BEGIN
  IF NEW.status NOT IN ('approved','published') THEN
    RETURN NEW;
  END IF;
  -- only gate the transition itself, so edits to an already-live case
  -- (e.g. fixing a typo) are not blocked by a re-check
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.image_license IS NULL OR btrim(NEW.image_license) = '' THEN
    v_missing := v_missing || 'an image license';
  END IF;

  SELECT count(*) INTO v_verified_refs
  FROM public.eeg_case_references r
  WHERE r.case_id = NEW.id AND r.verified = TRUE;
  IF v_verified_refs = 0 THEN
    v_missing := v_missing || 'at least one verified reference';
  END IF;

  IF NEW.reviewed_by IS NULL THEN
    v_missing := v_missing || 'an editor review (reviewed_by is empty)';
  ELSIF NEW.created_by IS NOT NULL AND NEW.reviewed_by = NEW.created_by THEN
    v_missing := v_missing || 'a review by someone other than its author (four-eyes rule)';
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot set status to %: this item still needs %.',
      NEW.status, array_to_string(v_missing, '; ')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS eeg_cases_publish_gate ON public.eeg_cases;
CREATE TRIGGER eeg_cases_publish_gate
  BEFORE INSERT OR UPDATE ON public.eeg_cases
  FOR EACH ROW EXECUTE FUNCTION public.eeg_cases_publish_gate();

-- Every content-bearing UPDATE snapshots the superseded state into
-- eeg_case_revisions and bumps version. Status-only / review-only updates and
-- response bookkeeping do not create noise.
CREATE OR REPLACE FUNCTION public.eeg_cases_version_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed BOOLEAN;
BEGIN
  v_changed :=
       OLD.title              IS DISTINCT FROM NEW.title
    OR OLD.clinical_vignette  IS DISTINCT FROM NEW.clinical_vignette
    OR OLD.lead_in            IS DISTINCT FROM NEW.lead_in
    OR OLD.image_caption      IS DISTINCT FROM NEW.image_caption
    OR OLD.question_prompt    IS DISTINCT FROM NEW.question_prompt
    OR OLD.explanation        IS DISTINCT FROM NEW.explanation
    OR OLD.teaching_points    IS DISTINCT FROM NEW.teaching_points
    OR OLD.key_points         IS DISTINCT FROM NEW.key_points
    OR OLD.learning_objective IS DISTINCT FROM NEW.learning_objective
    OR OLD.domain             IS DISTINCT FROM NEW.domain
    OR OLD.population         IS DISTINCT FROM NEW.population
    OR OLD.setting            IS DISTINCT FROM NEW.setting
    OR OLD.bloom              IS DISTINCT FROM NEW.bloom
    OR OLD.difficulty         IS DISTINCT FROM NEW.difficulty
    OR OLD.tags               IS DISTINCT FROM NEW.tags
    OR OLD.correct_region     IS DISTINCT FROM NEW.correct_region
    OR OLD.content            IS DISTINCT FROM NEW.content
    OR OLD.spec               IS DISTINCT FROM NEW.spec;

  IF NOT v_changed THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.eeg_case_revisions (case_id, version, content, changed_by, change_note)
  VALUES (
    OLD.id,
    OLD.version,
    COALESCE(OLD.content, to_jsonb(OLD)),
    auth.uid(),
    nullif(current_setting('pedquest.change_note', true), '')
  );

  -- an explicit version in the UPDATE wins (the importer sets it); otherwise
  -- advance by one
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS eeg_cases_version_bump ON public.eeg_cases;
CREATE TRIGGER eeg_cases_version_bump
  BEFORE UPDATE ON public.eeg_cases
  FOR EACH ROW EXECUTE FUNCTION public.eeg_cases_version_bump();

-- ============================================================
-- 5. Row-Level Security
-- ============================================================
ALTER TABLE public.eeg_case_references      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_case_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_case_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_case_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_case_render_jobs     ENABLE ROW LEVEL SECURITY;

-- ---------- eeg_cases ----------
-- The public policy from 20260714 stays as-is (published + date arrived).
-- Editors additionally see the whole pipeline and may edit it.
DROP POLICY IF EXISTS "Editors can read all cases" ON public.eeg_cases;
CREATE POLICY "Editors can read all cases" ON public.eeg_cases
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can insert cases" ON public.eeg_cases;
CREATE POLICY "Editors can insert cases" ON public.eeg_cases
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can update cases" ON public.eeg_cases;
CREATE POLICY "Editors can update cases" ON public.eeg_cases
  FOR UPDATE USING (public.is_pedquest_editor()) WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Admins can delete cases" ON public.eeg_cases;
CREATE POLICY "Admins can delete cases" ON public.eeg_cases
  FOR DELETE USING (public.is_pedquest_admin());

-- ---------- eeg_case_options ----------
-- The 20260714 "not publicly readable" policy (USING false) stays: it must
-- never leak an answer to anon. Permissive policies OR together, so adding an
-- editor policy widens access for editors only.
DROP POLICY IF EXISTS "Editors can read options" ON public.eeg_case_options;
CREATE POLICY "Editors can read options" ON public.eeg_case_options
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can insert options" ON public.eeg_case_options;
CREATE POLICY "Editors can insert options" ON public.eeg_case_options
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can update options" ON public.eeg_case_options;
CREATE POLICY "Editors can update options" ON public.eeg_case_options
  FOR UPDATE USING (public.is_pedquest_editor()) WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can delete options" ON public.eeg_case_options;
CREATE POLICY "Editors can delete options" ON public.eeg_case_options
  FOR DELETE USING (public.is_pedquest_editor());

-- ---------- eeg_responses ----------
-- Still no public read. A signed-in member may read their OWN responses
-- (progress page); everything aggregate is served by server code.
DROP POLICY IF EXISTS "Members can read their own responses" ON public.eeg_responses;
CREATE POLICY "Members can read their own responses" ON public.eeg_responses
  FOR SELECT USING (auth.uid() IS NOT NULL AND user_id = auth.uid());

-- ---------- references ----------
-- Citations are part of a published item, so they are public for published
-- cases; unpublished ones are editor-only.
DROP POLICY IF EXISTS "References of published cases are viewable" ON public.eeg_case_references;
CREATE POLICY "References of published cases are viewable" ON public.eeg_case_references
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.eeg_cases c
      WHERE c.id = eeg_case_references.case_id
        AND c.status = 'published'
        AND (c.publish_date IS NULL OR c.publish_date <= CURRENT_DATE)
    )
  );

DROP POLICY IF EXISTS "Editors can read all references" ON public.eeg_case_references;
CREATE POLICY "Editors can read all references" ON public.eeg_case_references
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can insert references" ON public.eeg_case_references;
CREATE POLICY "Editors can insert references" ON public.eeg_case_references
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can update references" ON public.eeg_case_references;
CREATE POLICY "Editors can update references" ON public.eeg_case_references
  FOR UPDATE USING (public.is_pedquest_editor()) WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Admins can delete references" ON public.eeg_case_references;
CREATE POLICY "Admins can delete references" ON public.eeg_case_references
  FOR DELETE USING (public.is_pedquest_admin());

-- ---------- revisions (read-only history for editors) ----------
DROP POLICY IF EXISTS "Editors can read revisions" ON public.eeg_case_revisions;
CREATE POLICY "Editors can read revisions" ON public.eeg_case_revisions
  FOR SELECT USING (public.is_pedquest_editor());
-- inserts come from the version-bump trigger (SECURITY DEFINER) or the
-- service role; no INSERT/UPDATE/DELETE policy is granted deliberately.

-- ---------- reviews ----------
DROP POLICY IF EXISTS "Editors can read reviews" ON public.eeg_case_reviews;
CREATE POLICY "Editors can read reviews" ON public.eeg_case_reviews
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can insert reviews" ON public.eeg_case_reviews;
CREATE POLICY "Editors can insert reviews" ON public.eeg_case_reviews
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Admins can delete reviews" ON public.eeg_case_reviews;
CREATE POLICY "Admins can delete reviews" ON public.eeg_case_reviews
  FOR DELETE USING (public.is_pedquest_admin());

-- ---------- job queues (service role + editor visibility) ----------
DROP POLICY IF EXISTS "Editors can read generation jobs" ON public.eeg_case_generation_jobs;
CREATE POLICY "Editors can read generation jobs" ON public.eeg_case_generation_jobs
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS "Editors can read render jobs" ON public.eeg_case_render_jobs;
CREATE POLICY "Editors can read render jobs" ON public.eeg_case_render_jobs
  FOR SELECT USING (public.is_pedquest_editor());
-- writes to both queues are service-role only (the cron route and the Python
-- render worker); no write policy is granted.
