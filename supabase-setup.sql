-- Run this once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references applications(id) on delete set null,
  parent_project_id uuid references projects(id) on delete set null,
  name text not null,
  repo_url text default '',
  local_path text default '',
  agent_instructions text default '',
  ready_for_agent boolean not null default false,
  branch text not null default 'main',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  area text default '',
  title text not null,
  status text not null default 'Inbox' check (status in ('Inbox','Now','Next','Later','Done')),
  priority text not null default 'Medium' check (priority in ('High','Medium','Low')),
  tags text[] not null default '{}',
  notes text default '',
  acceptance text default '',
  version text default '',
  ready_for_agent boolean not null default false,
  agent_notes text default '',
  files_likely text default '',
  dependencies text default '',
  do_not_change text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table applications enable row level security;
alter table projects enable row level security;
alter table features enable row level security;

drop policy if exists "applications_owner_all" on applications;
create policy "applications_owner_all" on applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "projects_owner_all" on projects;
create policy "projects_owner_all" on projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "features_owner_all" on features;
create policy "features_owner_all" on features for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists projects_user_idx on projects(user_id);
create index if not exists projects_application_idx on projects(application_id);
create index if not exists projects_parent_idx on projects(parent_project_id);
create index if not exists projects_ready_idx on projects(user_id, ready_for_agent) where ready_for_agent = true;
create index if not exists features_user_idx on features(user_id);
create index if not exists features_project_idx on features(project_id);
create index if not exists features_ready_idx on features(user_id, ready_for_agent) where ready_for_agent = true;


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
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists agent_notes_user_idx on agent_notes(user_id);
create index if not exists agent_notes_feature_idx on agent_notes(feature_id);
create index if not exists agent_notes_open_idx on agent_notes(user_id, resolved) where resolved = false;
