-- ============================================================
-- qEEG "Case of the Day" — async AI image-generation job queue
-- Migration: 20260716_case_image_jobs
-- Idempotent.
--
-- Vercel (Hobby, 60s function cap) cannot wait out the ~80s image
-- generation, so image gen is decoupled: the website ENQUEUES a job here
-- and a homelab worker (case-image-worker.py) polls this table, generates
-- via the OpenClaw $imagegen bridge, uploads the PNG to the eeg-cases
-- bucket, and writes the public URL back. The website polls for completion.
--
-- SECURITY: service-role only. No public/anon access at all — jobs are
-- created by admin API routes (service role) and processed by the worker
-- (service role). RLS is enabled with no permissive policy.
-- ============================================================

CREATE TABLE IF NOT EXISTS eeg_case_image_jobs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  description   TEXT NOT NULL,                 -- what to synthesize (Tier 3, original)
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','error')),
  image_url     TEXT,                          -- Supabase public URL once done
  ai_model      TEXT,                          -- e.g. cipher-openclaw
  error         TEXT,
  requested_by  UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eeg_case_image_jobs_status_idx
  ON eeg_case_image_jobs (status, created_at);

DROP TRIGGER IF EXISTS eeg_case_image_jobs_updated_at ON eeg_case_image_jobs;
CREATE TRIGGER eeg_case_image_jobs_updated_at BEFORE UPDATE ON eeg_case_image_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE eeg_case_image_jobs ENABLE ROW LEVEL SECURITY;
-- no policy → anon/authenticated denied; service role bypasses RLS.
DROP POLICY IF EXISTS "Image jobs are not publicly readable" ON eeg_case_image_jobs;
CREATE POLICY "Image jobs are not publicly readable" ON eeg_case_image_jobs
  FOR SELECT USING (false);
