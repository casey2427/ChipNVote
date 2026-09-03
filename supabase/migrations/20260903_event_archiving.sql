alter table public.events
  add column if not exists archived_at timestamptz;

create index if not exists events_group_archived_deadline_idx
  on public.events(group_id, archived_at, voting_deadline);

create or replace function public.archive_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group_id uuid;
  target_deadline timestamptz;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select e.group_id, e.voting_deadline
    into target_group_id, target_deadline
  from public.events e
  where e.id = p_event_id;

  if target_group_id is null then
    raise exception 'Event not found';
  end if;

  if not exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group_id
      and gm.user_id = auth.uid()
      and gm.role = 'owner'
  ) then
    raise exception 'Only the group leader can archive events';
  end if;

  if target_deadline is null or now() < target_deadline then
    raise exception 'Voting must end before this event can be archived';
  end if;

  update public.events
  set archived_at = coalesce(archived_at, now())
  where id = p_event_id;
end;
$$;

create or replace function public.auto_archive_expired_events(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_count integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not public.is_group_member(p_group_id) then
    raise exception 'You are not a member of this group';
  end if;

  update public.events
  set archived_at = voting_deadline + interval '7 days'
  where group_id = p_group_id
    and archived_at is null
    and voting_deadline is not null
    and voting_deadline <= now() - interval '7 days';

  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;

revoke all on function public.archive_event(uuid) from public, anon;
revoke all on function public.auto_archive_expired_events(uuid) from public, anon;
grant execute on function public.archive_event(uuid) to authenticated;
grant execute on function public.auto_archive_expired_events(uuid) to authenticated;

-- Event removal is no longer exposed to members; finished events are archived instead.
revoke delete on table public.events from authenticated, anon;
