-- ============================================================
-- EEG Teaching Lab — courses
-- Migration: 20260915_eeg_courses
--
-- The classroom layer over the lab: a teacher (role teacher+) creates a
-- course, enrols members by email, assigns published recordings with
-- instructions and a due date, and follows each student's progress:
--   not started → in progress (opened / has marks) → submitted → returned.
-- Shape follows Google Classroom / Canvas: course → roster → assignments →
-- one submission row per student per assignment; the gradebook is derived.
--
-- Enrolment is keyed by lowercase email (like user_roles) because a member
-- can be enrolled before they have ever signed in; user_id is backfilled the
-- first time the student loads their courses.
--
-- SECURITY: RLS enabled, no policies — every read and write goes through the
-- API routes with the service-role client, which check course membership in
-- code (src/lib/courses/server.ts). Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.eeg_courses (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  owner_id     UUID NOT NULL,
  owner_email  TEXT NOT NULL,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_courses_owner_idx ON public.eeg_courses (owner_id, status);

CREATE TABLE IF NOT EXISTS public.eeg_course_members (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id  UUID NOT NULL REFERENCES public.eeg_courses(id) ON DELETE CASCADE,
  email      TEXT NOT NULL CHECK (email = lower(email)),
  user_id    UUID,
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','instructor')),
  added_by   UUID,
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (course_id, email)
);
CREATE INDEX IF NOT EXISTS eeg_course_members_email_idx ON public.eeg_course_members (email);
CREATE INDEX IF NOT EXISTS eeg_course_members_user_idx  ON public.eeg_course_members (user_id);

CREATE TABLE IF NOT EXISTS public.eeg_course_assignments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  course_id     UUID NOT NULL REFERENCES public.eeg_courses(id) ON DELETE CASCADE,
  job_id        UUID NOT NULL REFERENCES public.eeg_lab_jobs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',
  task_id       TEXT NOT NULL DEFAULT 'seizure',
  due_at        TIMESTAMPTZ,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  published     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS eeg_course_assignments_course_idx ON public.eeg_course_assignments (course_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.eeg_course_submissions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id  UUID NOT NULL REFERENCES public.eeg_course_assignments(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  email          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','returned')),
  opened_at      TIMESTAMPTZ DEFAULT NOW(),
  submitted_at   TIMESTAMPTZ,
  returned_at    TIMESTAMPTZ,
  feedback       TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (assignment_id, user_id)
);
CREATE INDEX IF NOT EXISTS eeg_course_submissions_user_idx ON public.eeg_course_submissions (user_id);

DROP TRIGGER IF EXISTS eeg_courses_updated_at ON public.eeg_courses;
CREATE TRIGGER eeg_courses_updated_at BEFORE UPDATE ON public.eeg_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS eeg_course_assignments_updated_at ON public.eeg_course_assignments;
CREATE TRIGGER eeg_course_assignments_updated_at BEFORE UPDATE ON public.eeg_course_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS eeg_course_submissions_updated_at ON public.eeg_course_submissions;
CREATE TRIGGER eeg_course_submissions_updated_at BEFORE UPDATE ON public.eeg_course_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.eeg_courses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_course_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_course_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eeg_course_submissions  ENABLE ROW LEVEL SECURITY;
