-- Run this entire file once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  invite_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  chip_budget integer not null default 100 check (chip_budget between 10 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 500),
  location text check (char_length(location) <= 160),
  planned_for timestamptz,
  status text not null default 'open' check (status in ('open', 'chosen', 'archived')),
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key date not null,
  chips integer not null check (chips between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (plan_id, user_id, month_key)
);

create table if not exists public.super_votes (
  group_id uuid not null references public.groups(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key date not null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id, month_key)
);

create index if not exists plans_group_id_idx on public.plans(group_id);
create index if not exists votes_group_month_idx on public.votes(group_id, month_key);
create index if not exists super_votes_group_month_idx on public.super_votes(group_id, month_key);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid());
$$;

create or replace function public.generate_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare candidate text;
begin
  loop
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists(select 1 from public.groups where invite_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.create_group(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_group_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  insert into public.groups(name, invite_code, created_by)
  values(trim(p_name), public.generate_invite_code(), auth.uid()) returning id into new_group_id;
  insert into public.group_members(group_id, user_id, role) values(new_group_id, auth.uid(), 'owner');
  return new_group_id;
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select id into target_id from public.groups where invite_code = upper(trim(p_invite_code));
  if target_id is null then raise exception 'Room code not found'; end if;
  insert into public.group_members(group_id, user_id) values(target_id, auth.uid()) on conflict do nothing;
  return target_id;
end;
$$;

create or replace function public.set_plan_vote(p_plan_id uuid, p_chips integer)
returns void language plpgsql security definer set search_path = public as $$
declare target_group uuid; budget integer; other_chips integer; current_month date := date_trunc('month', current_date)::date;
begin
  if p_chips < 0 then raise exception 'Chip amount cannot be negative'; end if;
  select p.group_id, g.chip_budget into target_group, budget from public.plans p join public.groups g on g.id = p.group_id where p.id = p_plan_id and p.status = 'open';
  if target_group is null or not public.is_group_member(target_group) then raise exception 'Plan not found or access denied'; end if;
  select coalesce(sum(chips), 0) into other_chips from public.votes where group_id = target_group and user_id = auth.uid() and month_key = current_month and plan_id <> p_plan_id;
  if other_chips + p_chips > budget then raise exception 'You only have % chips remaining', budget - other_chips; end if;
  if p_chips = 0 then
    delete from public.votes where plan_id = p_plan_id and user_id = auth.uid() and month_key = current_month;
  else
    insert into public.votes(group_id, plan_id, user_id, month_key, chips)
    values(target_group, p_plan_id, auth.uid(), current_month, p_chips)
    on conflict(plan_id, user_id, month_key) do update set chips = excluded.chips, updated_at = now();
  end if;
end;
$$;

create or replace function public.toggle_super_vote(p_plan_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_group uuid; current_month date := date_trunc('month', current_date)::date; already_used boolean;
begin
  select group_id into target_group from public.plans where id = p_plan_id and status = 'open';
  if target_group is null or not public.is_group_member(target_group) then raise exception 'Plan not found or access denied'; end if;
  select exists(select 1 from public.super_votes where group_id = target_group and user_id = auth.uid() and month_key = current_month and plan_id = p_plan_id) into already_used;
  if already_used then
    delete from public.super_votes where group_id = target_group and user_id = auth.uid() and month_key = current_month;
    return false;
  end if;
  delete from public.super_votes where group_id = target_group and user_id = auth.uid() and month_key = current_month;
  insert into public.super_votes(group_id, plan_id, user_id, month_key) values(target_group, p_plan_id, auth.uid(), current_month);
  return true;
end;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.plans enable row level security;
alter table public.votes enable row level security;
alter table public.super_votes enable row level security;

drop policy if exists "Profiles are visible to signed in users" on public.profiles;
create policy "Profiles are visible to signed in users" on public.profiles for select to authenticated using (true);
drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "Members view groups" on public.groups;
create policy "Members view groups" on public.groups for select to authenticated using (public.is_group_member(id));
drop policy if exists "Members view memberships" on public.group_members;
create policy "Members view memberships" on public.group_members for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members view plans" on public.plans;
create policy "Members view plans" on public.plans for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members create plans" on public.plans;
create policy "Members create plans" on public.plans for insert to authenticated with check (created_by = auth.uid() and public.is_group_member(group_id));
drop policy if exists "Creators edit plans" on public.plans;
create policy "Creators edit plans" on public.plans for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid() and public.is_group_member(group_id));
drop policy if exists "Members view votes" on public.votes;
create policy "Members view votes" on public.votes for select to authenticated using (public.is_group_member(group_id));
drop policy if exists "Members view super votes" on public.super_votes;
create policy "Members view super votes" on public.super_votes for select to authenticated using (public.is_group_member(group_id));

drop view if exists public.plan_scores;
create view public.plan_scores with (security_invoker = true) as
select
  p.id, p.group_id, p.title, p.description, p.location, p.planned_for, p.created_at,
  coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id and v.month_key = date_trunc('month', current_date)::date), 0)::int as regular_points,
  (select count(*) from public.super_votes sv where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date)::int as super_votes,
  (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)::int as super_value,
  (select count(distinct supporter) from (
    select v.user_id as supporter from public.votes v where v.plan_id = p.id and v.month_key = date_trunc('month', current_date)::date
    union select sv.user_id from public.super_votes sv where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date
  ) people)::int as supporters,
  (coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id and v.month_key = date_trunc('month', current_date)::date), 0)
   + (select count(*) from public.super_votes sv where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date)
   * (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id))::int as total_score
from public.plans p where p.status = 'open';

grant select on public.profiles, public.groups, public.group_members, public.plans, public.votes, public.super_votes, public.plan_scores to authenticated;
grant insert on public.plans to authenticated;
grant update on public.profiles, public.plans to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.set_plan_vote(uuid, integer) from public, anon;
revoke execute on function public.toggle_super_vote(uuid) from public, anon;

grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.set_plan_vote(uuid, integer) to authenticated;
grant execute on function public.toggle_super_vote(uuid) to authenticated;
