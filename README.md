# Buildlist

Buildlist is a hosted feature-backlog command center for tracking features across After Effects, Cinema 4D, web, Swift, and other projects.

## Hosting
This repository is configured for Cloudflare Workers with static assets.

- Build command: leave blank
- Deploy command: `npx wrangler deploy`
- Preview command: `npx wrangler dev`

## Data
Buildlist uses Supabase for authentication and shared data.

1. Create a Supabase project.
2. Run `supabase-setup.sql` in the Supabase SQL editor.
3. Copy `public/config.example.js` to `public/config.js` and add your public Supabase URL and anon key.
4. Configure Cloudflare Worker secrets for the agent feed:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AGENT_USER_ID`
   - `AGENT_FEED_TOKEN`

Never put a Supabase service-role key in browser code.
