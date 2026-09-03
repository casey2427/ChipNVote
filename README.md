# ChipNVote

ChipNVote helps groups decide what they actually want to do by giving each member a persistent chip balance they can spend according to how strongly they care about each choice.

## Current mechanics

- New members start with 100 chips in each group.
- Members receive 10 more chips each day and unused chips roll over.
- Chips cannot be purchased.
- Voting stays blind until the event deadline.
- After the reveal, results show totals, supporters, and each member's chip contribution.
- Groups can compare availability with the built-in Find a Time tool.
- Finished events can be archived and preserved as group history.
- Chip access requires a permanent account; Google, Apple, and email sign-in are supported by the app.

## Stack

- Next.js 15 + TypeScript
- Supabase Auth + Postgres + Row Level Security
- Vercel-ready deployment

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and publishable key.
3. Apply the SQL in `supabase/schema.sql`, then apply the migrations in `supabase/migrations` in order.
4. Run `npm install` and `npm run dev`.

## Deploy

Import this repository into Vercel, add the environment variables from `.env.example`, configure your production Site URL and allowed auth redirect URLs in Supabase, and deploy.

Never expose the Supabase service-role or secret key in this application.
