-- Run this once in Supabase SQL Editor.
create table if not exists agent_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_id uuid not null references features(id) on delete cascade,
  agent text not null default 'Agent',
  note text not null,
  outcome text not null default 'Update'
    check (outcome in ('Completed','Partial','Blocked','Failed','Skipped','Update')),
  reason text default '',
  task_status text default '',
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table agent_notes enable row level security;

drop policy if exists "agent_notes_owner_all" on agent_notes;
create policy "agent_notes_owner_all" on agent_notes
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists agent_notes_user_idx on agent_notes(user_id);
create index if not exists agent_notes_feature_idx on agent_notes(feature_id);
create index if not exists agent_notes_open_idx on agent_notes(user_id, resolved) where resolved = false;
