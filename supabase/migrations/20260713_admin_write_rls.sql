-- ============================================================
-- Lock down write access to publications & abstracts
-- Migration: 20260713_admin_write_rls
--
-- Before: INSERT/UPDATE policies used `WITH CHECK (true)` / `USING (true)`,
-- so anyone holding the public anon key (embedded in the client bundle) could
-- insert or overwrite publications and abstracts. (Flagged by the Supabase
-- security advisor: rls_policy_always_true.)
--
-- After: writes require an authenticated session whose email is on the admin
-- allowlist. The existing admin UI already writes with the admin's logged-in
-- Supabase session, so it keeps working; the bare anon key (no email claim) is
-- denied. The service-role key still bypasses RLS (used by the cron scanner).
--
-- Public SELECT is unchanged. No DELETE policy is added (deletes remain denied
-- for non-service roles, as before).
-- Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_pedquest_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    lower(auth.jwt() ->> 'email') = ANY (ARRAY[
      'pressca@chop.edu',
      'craigpress@gmail.com',
      'gbenedet@med.umich.edu',
      'ajay.thomas@bcm.edu'
    ]),
    false
  );
$$;

-- publications
DROP POLICY IF EXISTS "Admins can insert publications" ON public.publications;
CREATE POLICY "Admins can insert publications" ON public.publications
  FOR INSERT WITH CHECK (public.is_pedquest_admin());

DROP POLICY IF EXISTS "Admins can update publications" ON public.publications;
CREATE POLICY "Admins can update publications" ON public.publications
  FOR UPDATE USING (public.is_pedquest_admin()) WITH CHECK (public.is_pedquest_admin());

-- abstracts
DROP POLICY IF EXISTS "Admins can insert abstracts" ON public.abstracts;
CREATE POLICY "Admins can insert abstracts" ON public.abstracts
  FOR INSERT WITH CHECK (public.is_pedquest_admin());

DROP POLICY IF EXISTS "Admins can update abstracts" ON public.abstracts;
CREATE POLICY "Admins can update abstracts" ON public.abstracts
  FOR UPDATE USING (public.is_pedquest_admin()) WITH CHECK (public.is_pedquest_admin());
