-- Editor grants + directory email fixes requested 2026-09-10.
-- Run once in the Supabase SQL editor (or: /admin/users → set role "editor").
-- user_roles is keyed by LOWERCASE email; the row may exist before the person's
-- first login — user_id is backfilled when they sign in.
--
-- Anuj's Authentik account carries anuj.jayakar@gmail.com, so that is the email
-- his OIDC login will arrive with; both addresses are granted.
-- Ajay Thomas is already an admin (seeded); admin ⊇ editor, no change needed.

INSERT INTO public.user_roles (email, role, granted_by) VALUES
  ('daniel.davila@bcm.edu',                     'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('rfarias@mcw.edu',                           'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('anuj.jayakar@nicklaushealth.org',           'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('anuj.jayakar@gmail.com',                    'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('dharrar@childrensnational.org',             'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('carlos.castillopinto@seattlechildrens.org', 'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com')),
  ('caligiuril@chop.edu',                        'editor', (SELECT user_id FROM public.user_roles WHERE email = 'craigpress@gmail.com'))
ON CONFLICT (email) DO UPDATE
  SET role = CASE WHEN public.user_roles.role = 'admin' THEN 'admin' ELSE 'editor' END,
      updated_at = now();

-- Four directory rows had no email, so /profile could not link the login to
-- the member record (and the bio editor would not open for them).
UPDATE public.members SET email = 'carlos.castillopinto@seattlechildrens.org' WHERE name = 'Carlos Castillo Pinto'  AND email IS NULL;
UPDATE public.members SET email = 'dharrar@childrensnational.org'             WHERE name = 'Dana B. Harrar'         AND email IS NULL;
UPDATE public.members SET email = 'daniel.davila@bcm.edu'                     WHERE name = 'Daniel Davila Williams' AND email IS NULL;
UPDATE public.members SET email = 'rfarias@mcw.edu'                           WHERE name = 'Raquel Farias-Moeller'  AND email IS NULL;
UPDATE public.members SET auth_email = 'anuj.jayakar@gmail.com'               WHERE name = 'Anuj Jayakar' AND lower(email) = 'anuj.jayakar@nicklaushealth.org';

SELECT email, role, user_id IS NOT NULL AS linked FROM public.user_roles ORDER BY role, email;
