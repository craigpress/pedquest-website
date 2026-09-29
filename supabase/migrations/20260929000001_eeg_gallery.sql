-- EEG feature gallery (/admin/eeg-lab/gallery): editor review state and notes per gallery item.
-- Items and images live in src/data/eeg-gallery.json and the private storage bucket eeg-gallery; only the review
-- layer is in the database. Service role only: every read and write goes through /api/admin/eeg-gallery/*, which
-- requires the editor role.

create table public.eeg_gallery_state (
  item_id text primary key,
  status text not null check (status in ('new', 'needs_review', 'accepted')),
  -- the renderer version the status was set against; a newer render shows the item as New again
  renderer_version text not null,
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
alter table public.eeg_gallery_state enable row level security;
revoke all on public.eeg_gallery_state from anon, authenticated;
grant all on public.eeg_gallery_state to service_role;

create table public.eeg_gallery_notes (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  renderer_version text not null,
  author_id uuid,
  author_name text,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
alter table public.eeg_gallery_notes enable row level security;
revoke all on public.eeg_gallery_notes from anon, authenticated;
grant all on public.eeg_gallery_notes to service_role;
create index eeg_gallery_notes_item on public.eeg_gallery_notes(item_id, created_at);
