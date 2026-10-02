-- ============================================================
-- member-files bucket: owner-scoped writes
-- Migration: 20261002000002_member_files_owner_write
--
-- Before (schema.sql): any authenticated user could INSERT any object into
-- the public member-files bucket, and the "own files" UPDATE policy had no
-- owner predicate, so any signed-in member could overwrite another member's
-- photo (photos/<id>.ext) or CV (cvs/<id>/<file>).
--
-- After: INSERT/UPDATE/DELETE require the object's storage owner to be the
-- caller (owner_id = auth.uid(), set by the Storage API from the JWT), or the
-- caller to be a PedQuEST admin (public.is_pedquest_admin(), user_roles).
-- Uploads from the profile and admin pages use the browser client with the
-- signed-in user's session, so the owner is set and these policies match.
-- An upsert over an object owned by someone else is now denied unless the
-- caller is an admin.
--
-- Reads are unchanged (public bucket, public SELECT). Whether CVs should stay
-- public is an owner decision (review S3).
-- Live policy names may differ from schema.sql; verify before applying.
-- Idempotent.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can upload member files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own files" ON storage.objects;

DROP POLICY IF EXISTS "member-files insert by owner or admin" ON storage.objects;
CREATE POLICY "member-files insert by owner or admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'member-files'
    AND (owner_id = (SELECT auth.uid())::text OR public.is_pedquest_admin())
  );

DROP POLICY IF EXISTS "member-files update by owner or admin" ON storage.objects;
CREATE POLICY "member-files update by owner or admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'member-files'
    AND (owner_id = (SELECT auth.uid())::text OR public.is_pedquest_admin())
  )
  WITH CHECK (
    bucket_id = 'member-files'
    AND (owner_id = (SELECT auth.uid())::text OR public.is_pedquest_admin())
  );

DROP POLICY IF EXISTS "member-files delete by owner or admin" ON storage.objects;
CREATE POLICY "member-files delete by owner or admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'member-files'
    AND (owner_id = (SELECT auth.uid())::text OR public.is_pedquest_admin())
  );
