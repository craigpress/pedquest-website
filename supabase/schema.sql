-- PedQuEST Database Schema
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/pdhxrbnciskbjwjuobus/sql

-- ============================================================
-- Members table
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  role TEXT,
  institution TEXT,
  department TEXT,
  country TEXT DEFAULT 'USA',
  city TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  bio TEXT,
  photo_url TEXT,
  orcid_id TEXT,
  interests TEXT[] DEFAULT '{}',
  email TEXT,
  website_url TEXT,
  is_leadership BOOLEAN DEFAULT FALSE,
  leadership_role TEXT CHECK (leadership_role IN ('co_director', 'scientific_committee', 'senior_advisor', 'education_lead')),
  sort_order INTEGER DEFAULT 999,
  auth_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Publications table
-- ============================================================
CREATE TABLE IF NOT EXISTS publications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT[] DEFAULT '{}',
  journal TEXT,
  year INTEGER,
  month INTEGER,
  doi TEXT,
  pmid TEXT UNIQUE,
  pmcid TEXT,
  abstract TEXT,
  pub_type TEXT DEFAULT 'journal-article',
  categories TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  patient_population TEXT DEFAULT 'Pediatric',
  is_member_paper BOOLEAN DEFAULT TRUE,
  member_author_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Conference Abstracts table
-- ============================================================
CREATE TABLE IF NOT EXISTS abstracts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  authors TEXT[] DEFAULT '{}',
  conference TEXT,
  presentation_type TEXT CHECK (presentation_type IN ('poster', 'platform', 'oral', 'invited')),
  date TEXT,
  location TEXT,
  year INTEGER,
  doi TEXT,
  pmid TEXT,
  member_author_ids TEXT[] DEFAULT '{}',
  is_member_paper BOOLEAN DEFAULT TRUE,
  categories TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Member documents (CVs, uploaded files)
-- ============================================================
CREATE TABLE IF NOT EXISTS member_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_url TEXT NOT NULL,
  document_type TEXT CHECK (document_type IN ('cv', 'biosketch', 'photo', 'other')),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Publication update log (tracks when publications were last checked)
-- ============================================================
CREATE TABLE IF NOT EXISTS publication_update_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  source TEXT DEFAULT 'pubmed',
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  new_publications_found INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success'
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_publications_pmid ON publications(pmid);
CREATE INDEX IF NOT EXISTS idx_publications_year ON publications(year);
CREATE INDEX IF NOT EXISTS idx_publications_member_authors ON publications USING GIN(member_author_ids);
CREATE INDEX IF NOT EXISTS idx_publications_categories ON publications USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_abstracts_year ON abstracts(year);
CREATE INDEX IF NOT EXISTS idx_abstracts_member_authors ON abstracts USING GIN(member_author_ids);
CREATE INDEX IF NOT EXISTS idx_members_leadership ON members(is_leadership);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

-- ============================================================
-- Roles (member / editor / admin) — added in 20260903_qbank.sql
--
-- email is the primary key because authorization runs off the JWT email
-- claim: the Authentik bridge mints a Supabase user lazily, so a role can be
-- granted before that user_id exists. user_id is backfilled on login.
-- Declared before the role predicates below because a LANGUAGE sql function
-- body is validated at CREATE time.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  email       TEXT PRIMARY KEY CHECK (email = lower(email)),
  user_id     UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','editor','admin')),
  granted_by  UUID,
  granted_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles (role);

-- Seed the founding admins (previously a hardcoded allowlist).
INSERT INTO public.user_roles (email, role) VALUES
  ('pressca@chop.edu',      'admin'),
  ('craigpress@gmail.com',  'admin'),
  ('gbenedet@med.umich.edu','admin'),
  ('ajay.thomas@bcm.edu',   'admin')
ON CONFLICT (email) DO NOTHING;

-- Role check: true when the requesting JWT's email has the 'admin' role in
-- public.user_roles (declared just above).
-- Used by publications/abstracts write policies below. Superseded the
-- hardcoded email allowlist in migration 20260903_qbank.sql. SECURITY DEFINER
-- is required so the lookup does not re-enter user_roles' own RLS policies.
-- Service-role key bypasses RLS entirely.
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

-- Editor predicate: question-bank content review (editor OR admin).
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

REVOKE ALL ON FUNCTION public.is_pedquest_admin()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_pedquest_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pedquest_admin()  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pedquest_editor() TO anon, authenticated;

-- user_roles RLS (declared here because the policies call the predicates above)
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own role" ON public.user_roles
  FOR SELECT USING (
    email = lower(COALESCE(auth.jwt() ->> 'email', '')) OR user_id = auth.uid()
  );
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT USING (public.is_pedquest_admin());
CREATE POLICY "Admins can insert roles" ON public.user_roles
  FOR INSERT WITH CHECK (public.is_pedquest_admin());
CREATE POLICY "Admins can update roles" ON public.user_roles
  FOR UPDATE USING (public.is_pedquest_admin()) WITH CHECK (public.is_pedquest_admin());
CREATE POLICY "Admins can delete roles" ON public.user_roles
  FOR DELETE USING (public.is_pedquest_admin());

-- Members: anyone can read, only authenticated members can edit their own
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members are viewable by everyone"
  ON members FOR SELECT
  USING (true);

CREATE POLICY "Members can update their own profile"
  ON members FOR UPDATE
  USING (auth.uid() = auth_user_id);

-- Publications: anyone can read, admins can insert/update
ALTER TABLE publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Publications are viewable by everyone"
  ON publications FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert publications"
  ON publications FOR INSERT
  WITH CHECK (public.is_pedquest_admin());

CREATE POLICY "Admins can update publications"
  ON publications FOR UPDATE
  USING (public.is_pedquest_admin())
  WITH CHECK (public.is_pedquest_admin());

-- Abstracts: same as publications
ALTER TABLE abstracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Abstracts are viewable by everyone"
  ON abstracts FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert abstracts"
  ON abstracts FOR INSERT
  WITH CHECK (public.is_pedquest_admin());

CREATE POLICY "Admins can update abstracts"
  ON abstracts FOR UPDATE
  USING (public.is_pedquest_admin())
  WITH CHECK (public.is_pedquest_admin());

-- Documents: members can manage their own
ALTER TABLE member_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Documents are viewable by everyone"
  ON member_documents FOR SELECT
  USING (true);

CREATE POLICY "Members can upload their own documents"
  ON member_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM members WHERE members.id = member_documents.member_id
      AND members.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Members can delete their own documents"
  ON member_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM members WHERE members.id = member_documents.member_id
      AND members.auth_user_id = auth.uid()
    )
  );

-- ============================================================
-- Membership Applications (from /join form)
-- ============================================================
CREATE TABLE IF NOT EXISTS membership_applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital TEXT NOT NULL,
  affiliated_university TEXT,
  pi_name TEXT,
  pi_email TEXT NOT NULL,
  pi_phone TEXT NOT NULL,
  role_title TEXT,
  research_interests TEXT,
  how_heard TEXT,
  statement_of_interest TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE membership_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only service role can read membership applications"
  ON membership_applications FOR SELECT
  USING (false); -- admins access via service role key, bypassing RLS

CREATE POLICY "Anyone can submit a membership application"
  ON membership_applications FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- Sponsor Inquiries (from /sponsor form)
-- ============================================================
CREATE TABLE IF NOT EXISTS sponsor_inquiries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  website TEXT,
  sponsorship_tier TEXT,
  areas_of_interest TEXT,
  collaboration_description TEXT,
  budget_range TEXT,
  how_heard TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sponsor_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only service role can read sponsor inquiries"
  ON sponsor_inquiries FOR SELECT
  USING (false);

CREATE POLICY "Anyone can submit a sponsor inquiry"
  ON sponsor_inquiries FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- Contact Messages (from /contact form)
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only service role can read contact messages"
  ON contact_messages FOR SELECT
  USING (false);

CREATE POLICY "Anyone can submit a contact message"
  ON contact_messages FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- Storage bucket for member photos and files
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-files', 'member-files', true)
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Anyone can view member files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'member-files');

CREATE POLICY "Authenticated users can upload member files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'member-files' AND auth.role() = 'authenticated');

CREATE POLICY "Users can update their own files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'member-files' AND auth.role() = 'authenticated');

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER members_updated_at
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER publications_updated_at
  BEFORE UPDATE ON publications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER abstracts_updated_at
  BEFORE UPDATE ON abstracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Question Bank objects — added in 20260903_qbank.sql
--
-- These extend the Case-of-the-Day tables, which are created by
-- supabase/migrations/20260714_eeg_cases.sql (and 20260715/20260716), not by
-- this file. Apply those migrations first; this section is the record of what
-- the question bank adds on top of them. See the migration for the seeded
-- admin rows, the widened image_license vocabulary and the full comments.
-- ============================================================

-- eeg_cases gains the bank fields
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
  ADD COLUMN IF NOT EXISTS image_attribution  TEXT,
  ADD COLUMN IF NOT EXISTS in_bank            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generation_job_id  UUID;

CREATE UNIQUE INDEX IF NOT EXISTS eeg_cases_qbank_id_uniq
  ON public.eeg_cases (qbank_id) WHERE qbank_id IS NOT NULL;

-- Evidence trail: every factual claim traces to a verified reference.
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
  open_access   TEXT,
  member_author BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only content history (written by the version-bump trigger).
CREATE TABLE IF NOT EXISTS public.eeg_case_revisions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id     UUID NOT NULL REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     JSONB,
  changed_by  UUID,
  change_note TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Editor decisions.
CREATE TABLE IF NOT EXISTS public.eeg_case_reviews (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id        UUID NOT NULL REFERENCES public.eeg_cases(id) ON DELETE CASCADE,
  reviewer       UUID,
  reviewer_email TEXT,
  decision       TEXT NOT NULL CHECK (decision IN ('approved','changes_requested','rejected')),
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Retrieval -> draft -> critic pipeline jobs.
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
  mode           TEXT NOT NULL DEFAULT 'new' CHECK (mode IN ('new','revision')),
  feedback       TEXT,   -- editor review notes, for mode = 'revision'
  error          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Render queue consumed by the tools/eeg-render Python worker.
-- CONTRACT: do not rename these columns.
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

-- Publish gate + revision trail triggers and the RLS policies for all of the
-- above are defined in supabase/migrations/20260903_qbank.sql.
