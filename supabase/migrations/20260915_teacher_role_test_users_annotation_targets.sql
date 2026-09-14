-- ============================================================
-- Teacher role, test accounts, annotation targets
-- Migration: 20260915_teacher_role_test_users_annotation_targets
--
-- 1. `teacher` joins the role ladder between member and editor. A teacher
--    sees every learner's marks on a lab recording, the class-results page
--    and the answer key, but cannot review, edit or publish anything.
-- 2. `user_roles.is_test` flags a synthetic account. Test accounts are left
--    out of every aggregate statistic (Case-of-the-Day stats, admin counts)
--    and are the only accounts an admin may switch into. `display_name`
--    gives the class-results page a name to show instead of an email.
-- 3. `eeg_lab_annotations` gains a TARGET: which pane the mark was placed on
--    (raw EEG or a trend row), which channels/derivations, and which head
--    region the learner names. Existing rows default to the raw pane with no
--    channel or region, which is exactly what they were.
-- 4. Kind `discharge` (sharp wave / spike) joins the mark vocabulary.
--
-- Idempotent.
-- ============================================================

-- ---------- 1. teacher role ----------
-- The original CHECK was declared inline, so its name is whatever Postgres
-- chose; drop every check constraint on user_roles that mentions `role`.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.user_roles'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_roles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_role_check CHECK (role IN ('member','teacher','editor','admin'));

CREATE OR REPLACE FUNCTION public.is_pedquest_teacher()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE email = lower(COALESCE(auth.jwt() ->> 'email', ''))
      AND role IN ('teacher','editor','admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_pedquest_teacher() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pedquest_teacher() TO anon, authenticated;

-- ---------- 2. test accounts ----------
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_test      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS display_name TEXT;
CREATE INDEX IF NOT EXISTS user_roles_is_test_idx ON public.user_roles (is_test) WHERE is_test;

-- ---------- 3. annotation targets ----------
ALTER TABLE public.eeg_lab_annotations
  ADD COLUMN IF NOT EXISTS pane      TEXT   NOT NULL DEFAULT 'raw';
ALTER TABLE public.eeg_lab_annotations
  ADD COLUMN IF NOT EXISTS trend_row TEXT;
ALTER TABLE public.eeg_lab_annotations
  ADD COLUMN IF NOT EXISTS channels  TEXT[] NOT NULL DEFAULT '{}'::TEXT[];
ALTER TABLE public.eeg_lab_annotations
  ADD COLUMN IF NOT EXISTS region    TEXT;

ALTER TABLE public.eeg_lab_annotations DROP CONSTRAINT IF EXISTS eeg_lab_annotations_pane_check;
ALTER TABLE public.eeg_lab_annotations
  ADD CONSTRAINT eeg_lab_annotations_pane_check CHECK (pane IN ('raw','trend'));

ALTER TABLE public.eeg_lab_annotations DROP CONSTRAINT IF EXISTS eeg_lab_annotations_region_check;
ALTER TABLE public.eeg_lab_annotations
  ADD CONSTRAINT eeg_lab_annotations_region_check CHECK (region IS NULL OR region IN (
    'left_frontal','right_frontal','left_temporal','right_temporal',
    'left_central','right_central','left_occipital','right_occipital',
    'left_hemisphere','right_hemisphere','generalized','midline'));

-- ---------- 4. kind vocabulary ----------
ALTER TABLE public.eeg_lab_annotations DROP CONSTRAINT IF EXISTS eeg_lab_annotations_kind_check;
ALTER TABLE public.eeg_lab_annotations
  ADD CONSTRAINT eeg_lab_annotations_kind_check
  CHECK (kind IN ('seizure','seizure_onset','discharge','artifact','state_change','medication','note'));

-- ---------- RLS: teachers read every learner's marks ----------
-- The API routes use the service role and gate in code (hasRole(role,'teacher'));
-- this keeps the direct-client view consistent with that.
DROP POLICY IF EXISTS eeg_lab_annotations_editor_read ON public.eeg_lab_annotations;
DROP POLICY IF EXISTS eeg_lab_annotations_teacher_read ON public.eeg_lab_annotations;
CREATE POLICY eeg_lab_annotations_teacher_read ON public.eeg_lab_annotations
  FOR SELECT USING (public.is_pedquest_teacher());
