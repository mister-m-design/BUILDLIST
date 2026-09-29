-- Run this once in Supabase SQL Editor on an existing Buildlist database.
alter table projects
  add column if not exists ready_for_agent boolean not null default false;

create index if not exists projects_ready_idx
  on projects(user_id, ready_for_agent)
  where ready_for_agent = true;
