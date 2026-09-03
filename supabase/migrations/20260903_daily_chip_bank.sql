-- Replace reset-based chip budgets with a rolling daily chip bank.
-- Every member starts with 10 chips, earns 10 more per day, and can bank up to 500 unused chips.

alter table public.groups
  add column if not exists daily_chip_amount integer not null default 10,
  add column if not exists chip_bank_cap integer not null default 500;

alter table public.groups drop constraint if exists groups_daily_chip_amount_check;
alter table public.groups
  add constraint groups_daily_chip_amount_check check (daily_chip_amount > 0);

alter table public.groups drop constraint if exists groups_chip_bank_cap_check;
alter table public.groups
  add constraint groups_chip_bank_cap_check check (chip_bank_cap >= daily_chip_amount);

alter table public.group_members
  add column if not exists chip_balance integer not null default 10,
  add column if not exists chip_last_accrual_date date not null default current_date;

alter table public.group_members drop constraint if exists group_members_chip_balance_check;
alter table public.group_members
  add constraint group_members_chip_balance_check check (chip_balance between 0 and 500);

-- The new economy starts fresh so old reset-based allocations do not give anyone an advantage.
delete from public.votes;

update public.groups
set daily_chip_amount = 10,
    chip_bank_cap = 500,
    chip_budget = 500,
    chip_reset_mode = 'monthly';

update public.group_members
set chip_balance = 10,
    chip_last_accrual_date = current_date;

alter table public.votes drop constraint if exists votes_chips_check;
alter table public.votes
  add constraint votes_chips_check check (chips >= 1);

create or replace function public.accrue_member_chips(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance integer;
  last_accrual date;
  daily_amount integer;
  bank_cap integer;
  days_elapsed integer;
begin
  select gm.chip_balance, gm.chip_last_accrual_date, g.daily_chip_amount, g.chip_bank_cap
  into current_balance, last_accrual, daily_amount, bank_cap
  from public.group_members gm
  join public.groups g on g.id = gm.group_id
  where gm.group_id = p_group_id and gm.user_id = p_user_id
  for update of gm;

  if not found then
    raise exception 'You are not a member of this group';
  end if;

  days_elapsed := greatest(current_date - last_accrual, 0);

  if days_elapsed > 0 then
    update public.group_members
    set chip_balance = least(bank_cap, current_balance + (days_elapsed * daily_amount)),
        chip_last_accrual_date = current_date
    where group_id = p_group_id and user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.get_my_chip_wallet(p_group_id uuid)
returns table(
  available_chips integer,
  daily_chips integer,
  bank_cap integer,
  last_accrual_date date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'Access denied'; end if;

  perform public.accrue_member_chips(p_group_id, auth.uid());

  return query
  select gm.chip_balance, g.daily_chip_amount, g.chip_bank_cap, gm.chip_last_accrual_date
  from public.group_members gm
  join public.groups g on g.id = gm.group_id
  where gm.group_id = p_group_id and gm.user_id = auth.uid();
end;
$$;

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_group_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  insert into public.groups(
    name, invite_code, created_by, chip_budget, chip_reset_mode, daily_chip_amount, chip_bank_cap
  )
  values(
    trim(p_name), public.generate_invite_code(), auth.uid(), 500, 'monthly', 10, 500
  )
  returning id into new_group_id;

  insert into public.group_members(
    group_id, user_id, role, chip_balance, chip_last_accrual_date
  )
  values(new_group_id, auth.uid(), 'owner', 10, current_date);

  return new_group_id;
end;
$$;

-- Kept temporarily for compatibility with any already-loaded older client bundle.
-- The reset-mode argument is intentionally ignored.
create or replace function public.create_group_with_settings(
  p_name text,
  p_chip_reset_mode text default 'monthly'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.create_group(p_name);
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select id into target_id
  from public.groups
  where invite_code = upper(trim(p_invite_code));

  if target_id is null then raise exception 'Room code not found'; end if;

  insert into public.group_members(
    group_id, user_id, chip_balance, chip_last_accrual_date
  )
  values(target_id, auth.uid(), 10, current_date)
  on conflict do nothing;

  return target_id;
end;
$$;

create or replace function public.get_my_vote_allocations(p_group_id uuid)
returns table(plan_id uuid, chips integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not public.is_group_member(p_group_id) then raise exception 'Access denied'; end if;

  return query
  select v.plan_id, v.chips
  from public.votes v
  where v.group_id = p_group_id
    and v.user_id = auth.uid();
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
  old_chips integer := 0;
  chip_delta integer;
  available integer;
  bank_cap integer;
  vote_key constant date := date '1970-01-01';
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_chips < 0 then raise exception 'Chip amount cannot be negative'; end if;

  select p.group_id, p.event_id
  into target_group, target_event
  from public.plans p
  where p.id = p_plan_id and p.status = 'open';

  if target_group is null or not public.is_group_member(target_group) then
    raise exception 'Plan not found or access denied';
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
  coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id), 0)::int as regular_points,
  (select count(*) from public.super_votes sv
    where sv.plan_id = p.id
      and sv.month_key = date_trunc('month', current_date)::date)::int as super_votes,
  (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)::int as super_value,
  (select count(distinct supporter) from (
    select v.user_id as supporter from public.votes v where v.plan_id = p.id
    union
    select sv.user_id from public.super_votes sv
    where sv.plan_id = p.id
      and sv.month_key = date_trunc('month', current_date)::date
  ) people)::int as supporters,
  (
    coalesce((select sum(v.chips) from public.votes v where v.plan_id = p.id), 0)
    + (select count(*) from public.super_votes sv
       where sv.plan_id = p.id
         and sv.month_key = date_trunc('month', current_date)::date)
      * (select count(*) * 20 from public.group_members gm where gm.group_id = p.group_id)
  )::int as total_score
from public.plans p
where p.status = 'open';

revoke execute on function public.accrue_member_chips(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.get_my_chip_wallet(uuid) from public, anon;
revoke execute on function public.get_my_vote_allocations(uuid) from public, anon;
revoke execute on function public.set_plan_vote(uuid, integer) from public, anon;
grant execute on function public.get_my_chip_wallet(uuid) to authenticated;
grant execute on function public.get_my_vote_allocations(uuid) to authenticated;
grant execute on function public.set_plan_vote(uuid, integer) to authenticated;
