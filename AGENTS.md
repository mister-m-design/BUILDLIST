# Buildlist agent notes

Buildlist is a lightweight feature-backlog command center.

## Architecture
- `public/index.html`: static shell and UI markup.
- `public/styles.css`: all styling.
- `public/app.js`: authentication, Supabase CRUD, filtering/rendering, import/export.
- `public/config.js`: public Supabase URL + anon key. These values are safe to expose; never put a service-role key here.
- `supabase-setup.sql`: database schema and RLS policies.
- `worker.js`: Cloudflare Worker, static asset serving, and the protected agent feed endpoint.
- `/api/agent/tasks`: returns only features marked Ready for Agent.

## Rules
- Never store feature/project data in source files after cloud mode is configured.
- Do not remove RLS policies.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code.
- UI changes should not require destructive database migrations.
- Preserve import/export compatibility where practical.
