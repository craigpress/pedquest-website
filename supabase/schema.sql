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
  WITH CHECK (true); -- Will restrict to admin role later

CREATE POLICY "Admins can update publications"
  ON publications FOR UPDATE
  USING (true); -- Will restrict to admin role later

-- Abstracts: same as publications
ALTER TABLE abstracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Abstracts are viewable by everyone"
  ON abstracts FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert abstracts"
  ON abstracts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins can update abstracts"
  ON abstracts FOR UPDATE
  USING (true);

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
