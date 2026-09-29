Buildlist is a lightweight feature-backlog command center.

Architecture:
- public/index.html: UI markup.
- public/styles.css: styling.
- public/app.js: Supabase auth, CRUD, filters, import/export.
- public/config.js: public Supabase URL and anon key only.
- worker.js: Cloudflare Worker and protected agent-feed API.
- supabase-setup.sql: database schema and RLS policies.

Rules:
- Never put a Supabase service-role key in browser code.
- Preserve row-level security.
- Keep feature/project data in Supabase rather than source files.
- Prefer additive, non-destructive schema changes.
- Preserve import/export compatibility where practical.
