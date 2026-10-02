-- ============================================================
-- Aggregate response counts per case
-- Migration: 20261002000003_eeg_response_counts
--
-- The editor queue (qbank-server.ts) and the admin cases list
-- (api/admin/cases) counted responses by fetching every eeg_responses row
-- for the listed cases. PostgREST caps a response at 1000 rows, so counts
-- were silently low once total responses passed 1000. This function returns
-- one row per case instead.
--
-- Service-role only, like every other read of eeg_responses. The app falls
-- back to the old row fetch if this function is absent.
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.eeg_response_counts(case_ids uuid[])
RETURNS TABLE (case_id uuid, response_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT r.case_id, count(*)::bigint
  FROM public.eeg_responses r
  WHERE r.case_id = ANY (case_ids)
  GROUP BY r.case_id;
$$;

REVOKE ALL ON FUNCTION public.eeg_response_counts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eeg_response_counts(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eeg_response_counts(uuid[]) TO service_role;
