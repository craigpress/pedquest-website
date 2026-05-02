-- Migration: align publications + publication_update_log with scan-publications route writes
-- Created 2026-05-01. Apply via Supabase SQL Editor or `supabase db push`.
-- Idempotent: uses IF NOT EXISTS / DROP+ADD where safe.

-- ============================================================
-- publications: add columns the auto-discovery route writes
-- ============================================================
ALTER TABLE publications
  ADD COLUMN IF NOT EXISTS discovered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS member_id          TEXT REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS mesh_terms         TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS publication_types  TEXT[] DEFAULT '{}';

-- Auto-discovered rows need an id; existing rows use manual "pub-N" ids.
-- Set a default so future inserts without explicit id succeed.
ALTER TABLE publications
  ALTER COLUMN id SET DEFAULT ('auto-' || replace(gen_random_uuid()::text, '-', ''));

CREATE INDEX IF NOT EXISTS idx_publications_member_id     ON publications(member_id);
CREATE INDEX IF NOT EXISTS idx_publications_discovered_at ON publications(discovered_at);

-- ============================================================
-- publication_update_log: align with route writes (per-PMID + per-scan)
-- ============================================================
ALTER TABLE publication_update_log
  ADD COLUMN IF NOT EXISTS pmid       TEXT,
  ADD COLUMN IF NOT EXISTS action     TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS metadata   JSONB;

CREATE INDEX IF NOT EXISTS idx_pub_update_log_pmid       ON publication_update_log(pmid);
CREATE INDEX IF NOT EXISTS idx_pub_update_log_action     ON publication_update_log(action);
CREATE INDEX IF NOT EXISTS idx_pub_update_log_scanned_at ON publication_update_log(scanned_at DESC);

-- ============================================================
-- RLS for publication_update_log (writes happen via service role; reads admin-only)
-- ============================================================
ALTER TABLE publication_update_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can read pub_update_log" ON publication_update_log;
CREATE POLICY "Service role can read pub_update_log"
  ON publication_update_log FOR SELECT
  USING (false); -- service role key bypasses RLS

DROP POLICY IF EXISTS "Service role can insert pub_update_log" ON publication_update_log;
CREATE POLICY "Service role can insert pub_update_log"
  ON publication_update_log FOR INSERT
  WITH CHECK (false); -- service role key bypasses RLS
