-- Blind voting: every event gets a voting deadline by default.
-- Aggregate results stay hidden until the deadline and voting closes when it is reached.

alter table public.events
  add column if not exists voting_deadline timestamptz;

update public.events
set voting_deadline = now() + interval '3 days'
where voting_deadline is null;

alter table public.events
  alter column voting_deadline set default (now() + interval '3 days');

-- Before a deadline, members may only read their own regular votes.
drop policy if exists "Members view votes" on public.votes;
create policy "Members view votes"
on public.votes
for select
to authenticated
using (
  public.is_group_member(group_id)
  and (
    user_id = auth.uid()
    or exists (
      select 1
      from public.events e
      where e.id = votes.event_id
        and (e.voting_deadline is null or e.voting_deadline <= now())
    )
  )
);

-- Super Votes follow the same blind-voting rule.
drop policy if exists "Members view super votes" on public.super_votes;
create policy "Members view super votes"
on public.super_votes
for select
to authenticated
using (
  public.is_group_member(group_id)
  and (
    user_id = auth.uid()
    or exists (
      select 1
      from public.plans p
      join public.events e on e.id = p.event_id
      where p.id = super_votes.plan_id
        and (e.voting_deadline is null or e.voting_deadline <= now())
    )
  )
);

create or replace function public.set_plan_vote(p_plan_id uuid, p_chips integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group uuid;
  target_event uuid;
  deadline timestamptz;
  old_chips integer := 0;
  chip_delta integer;
  available integer;
  bank_cap integer;
  vote_key constant date := date '1970-01-01';
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_chips < 0 then raise exception 'Chip amount cannot be negative'; end if;

  select p.group_id, p.event_id, e.voting_deadline
  into target_group, target_event, deadline
  from public.plans p
  join public.events e on e.id = p.event_id
  where p.id = p_plan_id and p.status = 'open';

  if target_group is null or not public.is_group_member(target_group) then
    raise exception 'Plan not found or access denied';
  end if;

  if deadline is not null and now() >= deadline then
    raise exception 'Voting has ended for this event';
  end if;

  perform public.accrue_member_chips(target_group, auth.uid());

  select gm.chip_balance, g.chip_bank_cap
  into available, bank_cap
  from public.group_members gm
  join public.groups g on g.id = gm.group_id
  where gm.group_id = target_group and gm.user_id = auth.uid()
  for update of gm;

  select coalesce(v.chips, 0)
  into old_chips
  from public.votes v
  where v.plan_id = p_plan_id
    and v.user_id = auth.uid()
  order by v.updated_at desc
  limit 1;

  old_chips := coalesce(old_chips, 0);
  chip_delta := p_chips - old_chips;

  if chip_delta > available then
    raise exception 'You only have % chips available', available;
  end if;

  if chip_delta > 0 then
    update public.group_members
    set chip_balance = chip_balance - chip_delta
    where group_id = target_group and user_id = auth.uid();
  elsif chip_delta < 0 then
    update public.group_members
    set chip_balance = least(bank_cap, chip_balance + abs(chip_delta))
    where group_id = target_group and user_id = auth.uid();
  end if;

  delete from public.votes
  where plan_id = p_plan_id and user_id = auth.uid();

  if p_chips > 0 then
    insert into public.votes(group_id, plan_id, event_id, user_id, month_key, chips)
    values(target_group, p_plan_id, target_event, auth.uid(), vote_key, p_chips);
  end if;
end;
$$;

create or replace function public.toggle_super_vote(p_plan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group uuid;
  deadline timestamptz;
  current_month date := date_trunc('month', current_date)::date;
  already_used boolean;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select p.group_id, e.voting_deadline
  into target_group, deadline
  from public.plans p
  join public.events e on e.id = p.event_id
  where p.id = p_plan_id and p.status = 'open';

  if target_group is null or not public.is_group_member(target_group) then
    raise exception 'Plan not found or access denied';
  end if;

  if deadline is not null and now() >= deadline then
    raise exception 'Voting has ended for this event';
  end if;

  select exists(
    select 1 from public.super_votes
    where group_id = target_group
      and user_id = auth.uid()
      and month_key = current_month
      and plan_id = p_plan_id
  ) into already_used;

  if already_used then
    delete from public.super_votes
    where group_id = target_group and user_id = auth.uid() and month_key = current_month;
    return false;
  end if;

  delete from public.super_votes
  where group_id = target_group and user_id = auth.uid() and month_key = current_month;

  insert into public.super_votes(group_id, plan_id, user_id, month_key)
  values(target_group, p_plan_id, auth.uid(), current_month);
  return true;
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
  case when e.voting_deadline is not null and now() < e.voting_deadline then 0
    else coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id), 0)::int end as regular_points,
  case when e.voting_deadline is not null and now() < e.voting_deadline then 0
    else (select count(*) from public.super_votes sv
      where sv.plan_id = p.id
        and sv.month_key = date_trunc('month', current_date)::date)::int end as super_votes,
  (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)::int as super_value,
  case when e.voting_deadline is not null and now() < e.voting_deadline then 0
    else (select count(distinct supporter) from (
      select v.user_id as supporter from public.votes v where v.plan_id = p.id
      union
      select sv.user_id from public.super_votes sv
      where sv.plan_id = p.id
        and sv.month_key = date_trunc('month', current_date)::date
    ) people)::int end as supporters,
  case when e.voting_deadline is not null and now() < e.voting_deadline then 0
    else (
      coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id), 0)
      + (select count(*) from public.super_votes sv
         where sv.plan_id = p.id
           and sv.month_key = date_trunc('month', current_date)::date)
        * (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)
    )::int end as total_score
from public.plans p
join public.events e on e.id = p.event_id
where p.status = 'open';
