create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare new_group_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account to start a group and receive chips';
  end if;

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
  values(new_group_id, auth.uid(), 'owner', 100, current_date);

  return new_group_id;
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
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in with Google, Apple, or email to join and receive chips';
  end if;

  select id into target_id
  from public.groups
  where invite_code = upper(trim(p_invite_code));

  if target_id is null then raise exception 'Room code not found'; end if;

  insert into public.group_members(
    group_id, user_id, chip_balance, chip_last_accrual_date
  )
  values(target_id, auth.uid(), 100, current_date)
  on conflict do nothing;

  return target_id;
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
  deadline timestamptz;
  old_chips integer := 0;
  chip_delta integer;
  available integer;
  bank_cap integer;
  vote_key constant date := date '1970-01-01';
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account before voting with chips';
  end if;
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
