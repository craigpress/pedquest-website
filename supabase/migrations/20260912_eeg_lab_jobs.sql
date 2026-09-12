-- EEG Teaching Lab: export + Persyst processing jobs.
--
-- Deliberately NOT a reuse of eeg_case_render_jobs.  That table requires a
-- case_id (tools/eeg-render/worker.py refuses a job without one) and the lab
-- produces case-less artifacts.  It also has no lease, so a worker that dies
-- mid-job strands the row in 'running' forever.
--
-- Two stages run on different hosts: `export` on the render host, `persyst` on
-- a licensed Windows box.  They are separate rows so one can succeed, be
-- inspected, and be reprocessed without redoing the other.
--
-- Retries are not optional here.  Persyst's PSCLI /Process faults with
-- 0xC0000005 on roughly one run in three (5/18 on unchanged input, measured
-- 2026-09-12 -- see docs/PSCLI_PHASE0A_RESULTS.md).  A worker without retry
-- logic fails a third of its jobs.

CREATE TABLE IF NOT EXISTS public.eeg_lab_jobs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  stage         TEXT NOT NULL DEFAULT 'export'
                  CHECK (stage IN ('export','persyst')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','done','error','cancelled')),

  -- what to make
  spec          JSONB NOT NULL,               -- normalized image block
  duration_s    DOUBLE PRECISION NOT NULL,    -- part of the recording's identity
  formats       TEXT[] NOT NULL DEFAULT ARRAY['lay'],
  options       JSONB NOT NULL DEFAULT '{}'::JSONB,  -- mmx preset, panel, include_answers

  -- identity, so a stale artifact can never be mistaken for a current one
  recording_id  TEXT,
  spec_hash     TEXT,
  renderer_version TEXT,

  -- results
  artifacts     JSONB,       -- {lay, dat, edf, answers, trends_csv} -> storage paths
  report        JSONB,       -- clipping counts, peak uV, detections, baseline status
  error         TEXT,

  -- lease + retry.  claimed_by/lease_expires_at let a crashed worker's job be
  -- reclaimed instead of sitting in 'running'; attempts caps the retry loop.
  claimed_by        TEXT,
  lease_expires_at  TIMESTAMPTZ,
  attempts          INT NOT NULL DEFAULT 0,
  max_attempts      INT NOT NULL DEFAULT 5,
  -- BIGINT, not INT: the fault we most need to record is 0xC0000005, which read
  -- as unsigned is 3,221,225,477 and overflows int4 at exactly the moment the
  -- worker is trying to log a failure. Writers should still fold to signed 32-bit.
  last_exit_code    BIGINT,

  requested_by  TEXT,
  parent_job_id UUID REFERENCES public.eeg_lab_jobs(id) ON DELETE SET NULL,
  expires_at    TIMESTAMPTZ,   -- retention: recordings are large, do not keep forever

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- The claim query: oldest pending (or expired-lease running) row for a stage.
CREATE INDEX IF NOT EXISTS eeg_lab_jobs_claim_idx
  ON public.eeg_lab_jobs (stage, status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS eeg_lab_jobs_requester_idx
  ON public.eeg_lab_jobs (requested_by, created_at DESC);

DROP TRIGGER IF EXISTS eeg_lab_jobs_updated_at ON public.eeg_lab_jobs;
CREATE TRIGGER eeg_lab_jobs_updated_at BEFORE UPDATE ON public.eeg_lab_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Editor-and-above only, matching the page.  Workers use the service role and
-- bypass RLS entirely.
ALTER TABLE public.eeg_lab_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eeg_lab_jobs_editor_read ON public.eeg_lab_jobs;
CREATE POLICY eeg_lab_jobs_editor_read ON public.eeg_lab_jobs
  FOR SELECT USING (public.is_pedquest_editor());

DROP POLICY IF EXISTS eeg_lab_jobs_editor_insert ON public.eeg_lab_jobs;
CREATE POLICY eeg_lab_jobs_editor_insert ON public.eeg_lab_jobs
  FOR INSERT WITH CHECK (public.is_pedquest_editor());

DROP POLICY IF EXISTS eeg_lab_jobs_editor_update ON public.eeg_lab_jobs;
CREATE POLICY eeg_lab_jobs_editor_update ON public.eeg_lab_jobs
  FOR UPDATE USING (public.is_pedquest_editor());

-- Private bucket.  eeg-cases is public=true with an anonymous SELECT policy, so
-- putting recordings there would hand every learner the instructor copy
-- regardless of how the page is gated.  Access is via signed URLs only.
INSERT INTO storage.buckets (id, name, public)
VALUES ('eeg-lab', 'eeg-lab', false)
ON CONFLICT (id) DO NOTHING;
