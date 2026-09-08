# ChipNVote

ChipNVote helps groups decide what they actually want by giving every participant 100 chips to split across one event's choices.

## Current mechanics

- Create an event and add at least two choices.
- Share the event's invite link or eight-character code.
- Friends join with only a display name; no account is required.
- Every participant gets a fresh 100-chip budget for that event.
- Participants may split those chips however they want and revise their allocation.
- Results stay visible and automatically rank the choice with the most chips first.
- Event creators can allow participant suggestions and remove duplicate participants.
- A random browser token remembers each participant without storing the raw token in the database.

## Stack

- Next.js 15 + TypeScript
- Supabase Postgres + Row Level Security + restricted public RPCs
- Vercel-ready deployment

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and publishable key.
3. Apply the SQL in `supabase/schema.sql`, then apply the migrations in `supabase/migrations` in order. The latest migration adds the no-account event flow.
4. Run `npm install` and `npm run dev`.

## Deploy

Import this repository into Vercel, add the environment variables from `.env.example`, and deploy.

Never expose the Supabase service-role or secret key in this application.
