-- 2026-09-10
-- 1. Publication semantics: approving a bank item is what opens it to learners.
--    status = 'published' now only means "also in the Case-of-the-Day rotation"
--    (publish_date). Server code reads with the service role, so these policies
--    only matter for the anon/RLS client, but they must agree with the app.
DROP POLICY IF EXISTS "Published cases are viewable by everyone" ON public.eeg_cases;
CREATE POLICY "Published cases are viewable by everyone" ON public.eeg_cases
  FOR SELECT USING (
    (status = 'published' AND (publish_date IS NULL OR publish_date <= CURRENT_DATE))
    OR (status = 'approved' AND in_bank)
  );

DROP POLICY IF EXISTS "References of published cases are viewable" ON public.eeg_case_references;
CREATE POLICY "References of published cases are viewable" ON public.eeg_case_references
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.eeg_cases c
      WHERE c.id = eeg_case_references.case_id
        AND (
          (c.status = 'published' AND (c.publish_date IS NULL OR c.publish_date <= CURRENT_DATE))
          OR (c.status = 'approved' AND c.in_bank)
        )
    )
  );

-- 2. Profile self-edit. members.auth_user_id is never populated by the app, so
--    the old uid-only policy rejected every save from /profile (the page then
--    fell back to localStorage). Match on the signed-in email as well, on either
--    of the two email columns the directory uses.
DROP POLICY IF EXISTS "Members can update their own profile" ON public.members;
CREATE POLICY "Members can update their own profile" ON public.members
  FOR UPDATE USING (
    (auth.uid() IS NOT NULL AND auth.uid() = auth_user_id)
    OR (
      lower(coalesce(auth.jwt() ->> 'email', '')) <> ''
      AND lower(coalesce(auth.jwt() ->> 'email', '')) IN (lower(email), lower(auth_email))
    )
  )
  WITH CHECK (
    (auth.uid() IS NOT NULL AND auth.uid() = auth_user_id)
    OR (
      lower(coalesce(auth.jwt() ->> 'email', '')) <> ''
      AND lower(coalesce(auth.jwt() ->> 'email', '')) IN (lower(email), lower(auth_email))
    )
  );
