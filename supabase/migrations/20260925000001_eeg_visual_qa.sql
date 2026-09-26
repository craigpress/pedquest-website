-- Advisory QA never mutates clinical decisions or schedules another render.
create table public.eeg_visual_qa (
  id uuid primary key default gen_random_uuid(),
  generation_key text not null unique,
  source text not null check (source in ('qbank', 'lab')),
  job_id uuid not null,
  artifact_hash text not null,
  artifact_hashes jsonb not null,
  status text not null check (status in ('running', 'pass', 'needs_review')),
  attempts integer not null default 1 check (attempts = 1),
  prompt_version text not null,
  prompt text not null,
  model text not null,
  context jsonb not null,
  report jsonb,
  created_at timestamptz not null default now()
);
alter table public.eeg_visual_qa enable row level security;
revoke all on public.eeg_visual_qa from anon, authenticated;
grant all on public.eeg_visual_qa to service_role;
create index eeg_visual_qa_flagged on public.eeg_visual_qa(status, created_at desc);

create table public.eeg_feature_corrections (
  source text not null check (source in ('qbank', 'lab')),
  resource_id uuid not null,
  feature_id text not null,
  disposition text not null check (disposition in ('confirmed_mention', 'dismissed')),
  primary key (source, resource_id, feature_id)
);
alter table public.eeg_feature_corrections enable row level security;
revoke all on public.eeg_feature_corrections from anon, authenticated;
grant all on public.eeg_feature_corrections to service_role;
