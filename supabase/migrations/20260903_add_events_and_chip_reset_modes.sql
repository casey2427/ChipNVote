alter table public.groups
  add column if not exists chip_reset_mode text not null default 'monthly';

alter table public.groups drop constraint if exists groups_chip_reset_mode_check;
alter table public.groups
  add constraint groups_chip_reset_mode_check check (chip_reset_mode in ('monthly', 'weekly', 'event'));

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  event_date date,
  created_at timestamptz not null default now()
);

create index if not exists events_group_date_idx on public.events(group_id, event_date, created_at);

alter table public.plans add column if not exists event_id uuid references public.events(id) on delete cascade;
alter table public.votes add column if not exists event_id uuid references public.events(id) on delete cascade;
create index if not exists plans_event_id_idx on public.plans(event_id);
create index if not exists votes_event_user_idx on public.votes(event_id, user_id);

-- Put existing plans into one Date TBD event per group so nothing gets lost.
insert into public.events(group_id, created_by, title, event_date)
select g.id, g.created_by, 'General ideas', null
from public.groups g
where exists (select 1 from public.plans p where p.group_id = g.id and p.event_id is null)
  and not exists (select 1 from public.events e where e.group_id = g.id and e.title = 'General ideas' and e.event_date is null);

update public.plans p
set event_id = (
  select e.id from public.events e
  where e.group_id = p.group_id and e.title = 'General ideas' and e.event_date is null
  order by e.created_at asc limit 1
)
where p.event_id is null;

update public.votes v
set event_id = p.event_id
from public.plans p
where p.id = v.plan_id and v.event_id is null;

alter table public.plans alter column event_id set not null;

alter table public.events enable row level security;

drop policy if exists "Members view events" on public.events;
create policy "Members view events" on public.events
for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "Members create events" on public.events;
create policy "Members create events" on public.events
for insert to authenticated with check (created_by = auth.uid() and public.is_group_member(group_id));

drop policy if exists "Creators and owners update events" on public.events;
create policy "Creators and owners update events" on public.events
for update to authenticated
using (
  created_by = auth.uid() or exists (
    select 1 from public.group_members gm
    where gm.group_id = events.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
)
with check (public.is_group_member(group_id));

drop policy if exists "Creators and owners delete events" on public.events;
create policy "Creators and owners delete events" on public.events
for delete to authenticated
using (
  created_by = auth.uid() or exists (
    select 1 from public.group_members gm
    where gm.group_id = events.group_id and gm.user_id = auth.uid() and gm.role = 'owner'
  )
);

grant select, insert, update, delete on public.events to authenticated;

create or replace function public.vote_period_start(p_mode text)
returns date
language sql
stable
set search_path = public
as $$
  select case p_mode
    when 'weekly' then date_trunc('week', current_date)::date
    else date_trunc('month', current_date)::date
  end;
$$;

create or replace function public.create_group_with_settings(
  p_name text,
  p_chip_reset_mode text default 'monthly'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_group_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_chip_reset_mode not in ('monthly', 'weekly', 'event') then
    raise exception 'Invalid chip reset mode';
  end if;

  insert into public.groups(name, invite_code, created_by, chip_budget, chip_reset_mode)
  values(trim(p_name), public.generate_invite_code(), auth.uid(), 100, p_chip_reset_mode)
  returning id into new_group_id;

  insert into public.group_members(group_id, user_id, role)
  values(new_group_id, auth.uid(), 'owner');

  return new_group_id;
end;
$$;

create or replace function public.get_my_vote_allocations(p_group_id uuid)
returns table(plan_id uuid, chips integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  reset_mode text;
  period_start date;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'Access denied'; end if;

  select g.chip_reset_mode into reset_mode from public.groups g where g.id = p_group_id;

  if reset_mode = 'event' then
    return query
      select distinct on (v.plan_id) v.plan_id, v.chips
      from public.votes v
      where v.group_id = p_group_id and v.user_id = auth.uid()
      order by v.plan_id, v.month_key desc, v.updated_at desc;
  else
    period_start := public.vote_period_start(reset_mode);
    return query
      select v.plan_id, v.chips
      from public.votes v
      where v.group_id = p_group_id
        and v.user_id = auth.uid()
        and v.month_key = period_start;
  end if;
end;
$$;

create or replace function public.set_plan_vote(p_plan_id uuid, p_chips integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group uuid;
  target_event uuid;
  budget integer;
  reset_mode text;
  period_start date;
  other_chips integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_chips < 0 then raise exception 'Chip amount cannot be negative'; end if;

  select p.group_id, p.event_id, g.chip_budget, g.chip_reset_mode
  into target_group, target_event, budget, reset_mode
  from public.plans p
  join public.groups g on g.id = p.group_id
  where p.id = p_plan_id and p.status = 'open';

  if target_group is null or not public.is_group_member(target_group) then
    raise exception 'Plan not found or access denied';
  end if;

  if reset_mode = 'event' then
    select coalesce(sum(v.chips), 0)::int into other_chips
    from public.votes v
    where v.group_id = target_group
      and v.user_id = auth.uid()
      and v.event_id = target_event
      and v.plan_id <> p_plan_id;

    if other_chips + p_chips > budget then
      raise exception 'You only have % chips remaining for this event', budget - other_chips;
    end if;

    delete from public.votes
    where plan_id = p_plan_id and user_id = auth.uid();

    if p_chips > 0 then
      insert into public.votes(group_id, plan_id, event_id, user_id, month_key, chips)
      values(target_group, p_plan_id, target_event, auth.uid(), current_date, p_chips);
    end if;
  else
    period_start := public.vote_period_start(reset_mode);

    select coalesce(sum(v.chips), 0)::int into other_chips
    from public.votes v
    where v.group_id = target_group
      and v.user_id = auth.uid()
      and v.month_key = period_start
      and v.plan_id <> p_plan_id;

    if other_chips + p_chips > budget then
      raise exception 'You only have % chips remaining', budget - other_chips;
    end if;

    if p_chips = 0 then
      delete from public.votes
      where plan_id = p_plan_id and user_id = auth.uid() and month_key = period_start;
    else
      insert into public.votes(group_id, plan_id, event_id, user_id, month_key, chips)
      values(target_group, p_plan_id, target_event, auth.uid(), period_start, p_chips)
      on conflict(plan_id, user_id, month_key)
      do update set chips = excluded.chips, event_id = excluded.event_id, updated_at = now();
    end if;
  end if;
end;
$$;

drop view if exists public.plan_scores;
create view public.plan_scores with (security_invoker = true) as
select
  p.id,
  p.group_id,
  p.event_id,
  p.title,
  p.description,
  p.location,
  p.planned_for,
  p.created_at,
  coalesce((
    select sum(v.chips)
    from public.votes v
    where v.plan_id = p.id
      and (
        (g.chip_reset_mode = 'event' and v.event_id = p.event_id)
        or
        (g.chip_reset_mode <> 'event' and v.month_key = public.vote_period_start(g.chip_reset_mode))
      )
  ), 0)::int as regular_points,
  (select count(*) from public.super_votes sv
    where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date)::int as super_votes,
  (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)::int as super_value,
  (select count(distinct supporter) from (
    select v.user_id as supporter
    from public.votes v
    where v.plan_id = p.id
      and (
        (g.chip_reset_mode = 'event' and v.event_id = p.event_id)
        or
        (g.chip_reset_mode <> 'event' and v.month_key = public.vote_period_start(g.chip_reset_mode))
      )
    union
    select sv.user_id
    from public.super_votes sv
    where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date
  ) people)::int as supporters,
  (
    coalesce((
      select sum(v.chips)
      from public.votes v
      where v.plan_id = p.id
        and (
          (g.chip_reset_mode = 'event' and v.event_id = p.event_id)
          or
          (g.chip_reset_mode <> 'event' and v.month_key = public.vote_period_start(g.chip_reset_mode))
        )
    ), 0)
    + (select count(*) from public.super_votes sv
       where sv.plan_id = p.id and sv.month_key = date_trunc('month', current_date)::date)
      * (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)
  )::int as total_score
from public.plans p
join public.groups g on g.id = p.group_id
where p.status = 'open';

grant select on public.plan_scores to authenticated;

revoke execute on function public.vote_period_start(text) from public, anon;
grant execute on function public.vote_period_start(text) to authenticated;
revoke execute on function public.create_group_with_settings(text, text) from public, anon;
grant execute on function public.create_group_with_settings(text, text) to authenticated;
revoke execute on function public.get_my_vote_allocations(uuid) from public, anon;
grant execute on function public.get_my_vote_allocations(uuid) to authenticated;
