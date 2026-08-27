# ChipNVote

ChipNVote helps friend groups decide what to do by giving every member the same limited monthly chip balance and one Super Vote.

## Stack

- Next.js 15 + TypeScript
- Supabase Auth + Postgres + Row Level Security
- Vercel-ready deployment

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and publishable/anon key.
3. Run `supabase/schema.sql` in the Supabase SQL Editor.
4. Run `npm install` and `npm run dev`.

## Deploy

Import this repository into Vercel, add the two environment variables from `.env.example`, and deploy.

Never expose the Supabase service-role key in this application.
