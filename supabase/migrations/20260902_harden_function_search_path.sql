-- ============================================================
-- Security linter fix: pin the trigger function's search_path
-- Migration: 20260902_harden_function_search_path
--
-- Supabase's security advisor flags 0011_function_search_path_mutable: a
-- function with a role-mutable search_path can be hijacked by a caller who
-- puts a shadowing schema ahead of public. The body of update_updated_at only
-- calls now(), which resolves from pg_catalog regardless, so pinning the
-- search_path to '' is safe and leaves the trigger behaviour unchanged.
-- ============================================================

ALTER FUNCTION public.update_updated_at() SET search_path = '';
