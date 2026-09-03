create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select role into member_role
  from public.group_members
  where group_id = p_group_id and user_id = auth.uid();

  if member_role is null then
    raise exception 'You are not a member of this group';
  end if;

  if member_role = 'owner' then
    raise exception 'Group owners must delete the group instead';
  end if;

  delete from public.votes
  where group_id = p_group_id and user_id = auth.uid();

  delete from public.super_votes
  where group_id = p_group_id and user_id = auth.uid();

  delete from public.group_members
  where group_id = p_group_id and user_id = auth.uid();
end;
$$;

create or replace function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.group_members
    where group_id = p_group_id
      and user_id = auth.uid()
      and role = 'owner'
  ) then
    raise exception 'Only the group owner can delete this group';
  end if;

  delete from public.groups where id = p_group_id;
end;
$$;

revoke execute on function public.leave_group(uuid) from public, anon;
revoke execute on function public.delete_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
