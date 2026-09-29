-- Run this once in Supabase SQL Editor on an existing Buildlist database.
alter table projects
  add column if not exists parent_project_id uuid references projects(id) on delete set null;

create index if not exists projects_parent_idx
  on projects(parent_project_id);
