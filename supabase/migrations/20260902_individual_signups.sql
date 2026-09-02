-- ============================================================
-- Individual affiliates
-- Migration: 20260902_individual_signups
--
-- The /join split: `membership_applications` is the institutional track (a site
-- joining the consortium), this table is the individual track — a clinician or
-- researcher who wants meeting invites and consortium news without their centre
-- signing on.
--
-- No IP column by design; the client IP is used for rate limiting only and is
-- never persisted (see /privacy).
--
-- RLS: no anon policy at all, so only the service-role client behind the API
-- route and `requireAdmin()` can read or write.
-- ============================================================

CREATE TABLE IF NOT EXISTS individual_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  institution TEXT,
  country TEXT,
  role_title TEXT,
  interests TEXT,
  -- Set when the submitted email matched someone already in the member
  -- registry, so admins can merge rather than create a duplicate record.
  matched_member_id TEXT,
  -- Explicit opt-in to meeting invites and consortium news.
  consent_email BOOLEAN NOT NULL DEFAULT FALSE,
  consent_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One row per person; a repeat submission upserts rather than duplicating.
-- A plain column constraint, not lower(email): PostgREST's on_conflict can't
-- target an expression index, and the API route always stores email lowercased.
ALTER TABLE individual_signups
  DROP CONSTRAINT IF EXISTS individual_signups_email_key;
ALTER TABLE individual_signups
  ADD CONSTRAINT individual_signups_email_key UNIQUE (email);

CREATE INDEX IF NOT EXISTS individual_signups_created_at_idx
  ON individual_signups (created_at DESC);

ALTER TABLE individual_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Only service role can read individual signups" ON individual_signups;
CREATE POLICY "Only service role can read individual signups"
  ON individual_signups FOR SELECT
  USING (FALSE);
