-- Run this once in Supabase SQL Editor on an existing Buildlist database.
alter table projects
  add column if not exists parent_project_id uuid references projects(id) on delete set null;

create index if not exists projects_parent_idx
  on projects(parent_project_id);


-- Optional initial organization for existing Cinema 4D ASPECT tools.
insert into projects (
  user_id,
  application_id,
  name,
  repo_url,
  local_path,
  agent_instructions,
  ready_for_agent,
  branch
)
select
  a.user_id,
  a.id,
  'ASPECT Panel',
  '',
  '',
  '',
  false,
  'main'
from applications a
where a.name = 'Cinema 4D'
  and not exists (
    select 1
    from projects p
    where p.user_id = a.user_id
      and p.application_id = a.id
      and p.name = 'ASPECT Panel'
  );

update projects child
set parent_project_id = parent.id
from projects parent
where child.user_id = parent.user_id
  and child.application_id = parent.application_id
  and parent.name = 'ASPECT Panel'
  and child.name in (
    'ASPECT Material Browser',
    'ASPECT Snoot',
    'ASPECT Light Mixer',
    'ASPECT HDRI Browser',
    'ASPECT Scene Sort'
  );
