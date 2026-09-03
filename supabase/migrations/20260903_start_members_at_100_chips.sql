-- Give every member a useful starting balance while keeping the +10/day rollover system.

alter table public.group_members
  alter column chip_balance set default 100;

-- Bring current members up to the new starting balance without reducing anyone who already has more.
update public.group_members
set chip_balance = greatest(chip_balance, 100);

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
