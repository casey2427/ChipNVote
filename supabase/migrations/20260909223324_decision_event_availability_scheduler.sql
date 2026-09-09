create table if not exists public.decision_schedule_settings (
  event_id uuid primary key references public.decision_events(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  start_hour integer not null default 9 check (start_hour between 0 and 23),
  end_hour integer not null default 22 check (end_hour between 1 and 24 and end_hour > start_hour),
  slot_minutes integer not null default 60 check (slot_minutes in (30, 60)),
  timezone text not null default 'Local time' check (char_length(timezone) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 13)
);

create table if not exists public.decision_schedule_availability (
  event_id uuid not null,
  participant_id uuid not null,
  slot_key text not null check (char_length(slot_key) between 10 and 32),
  preference smallint not null check (preference in (1, 2)),
  updated_at timestamptz not null default now(),
  primary key (event_id, participant_id, slot_key),
  foreign key (event_id, participant_id)
    references public.decision_participants(event_id, id) on delete cascade
);

create index if not exists decision_schedule_availability_event_idx
  on public.decision_schedule_availability(event_id);

alter table public.decision_schedule_settings enable row level security;
alter table public.decision_schedule_availability enable row level security;
revoke all on table public.decision_schedule_settings from anon, authenticated;
revoke all on table public.decision_schedule_availability from anon, authenticated;

create or replace function public.get_decision_schedule(
  p_invite_code text,
  p_device_token text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  viewer_participant_id uuid;
  schedule public.decision_schedule_settings%rowtype;
  viewer_preferences jsonb := '[]'::jsonb;
  summary jsonb := '[]'::jsonb;
  responded_count integer := 0;
begin
  select e.id, p.id
  into target_event_id, viewer_participant_id
  from public.decision_events e
  left join public.decision_participants p
    on p.event_id = e.id
   and p.device_token_hash = public.decision_token_hash(p_device_token)
  where e.invite_code = upper(trim(p_invite_code));

  if target_event_id is null then raise exception 'Event not found'; end if;
  if viewer_participant_id is null then raise exception 'Join this event before setting availability'; end if;

  select * into schedule
  from public.decision_schedule_settings
  where event_id = target_event_id;

  if schedule.event_id is null then
    return jsonb_build_object(
      'settings', null,
      'viewer_preferences', '[]'::jsonb,
      'summary', '[]'::jsonb,
      'responded_count', 0
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_key', a.slot_key,
    'preference', a.preference
  ) order by a.slot_key), '[]'::jsonb)
  into viewer_preferences
  from public.decision_schedule_availability a
  where a.event_id = target_event_id
    and a.participant_id = viewer_participant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_key', grouped.slot_key,
    'available', grouped.available,
    'preferred', grouped.preferred
  ) order by grouped.slot_key), '[]'::jsonb)
  into summary
  from (
    select
      a.slot_key,
      count(*)::integer as available,
      count(*) filter (where a.preference = 2)::integer as preferred
    from public.decision_schedule_availability a
    where a.event_id = target_event_id
    group by a.slot_key
  ) grouped;

  select count(distinct participant_id)::integer
  into responded_count
  from public.decision_schedule_availability
  where event_id = target_event_id;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'start_date', schedule.start_date,
      'end_date', schedule.end_date,
      'start_hour', schedule.start_hour,
      'end_hour', schedule.end_hour,
      'slot_minutes', schedule.slot_minutes,
      'timezone', schedule.timezone
    ),
    'viewer_preferences', viewer_preferences,
    'summary', summary,
    'responded_count', responded_count
  );
end;
$$;

create or replace function public.setup_decision_schedule(
  p_invite_code text,
  p_device_token text,
  p_start_date date,
  p_end_date date,
  p_start_hour integer,
  p_end_hour integer,
  p_slot_minutes integer,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  creator_valid boolean := false;
begin
  select e.id, coalesce(p.is_creator, false)
  into target_event_id, creator_valid
  from public.decision_events e
  left join public.decision_participants p
    on p.event_id = e.id
   and p.device_token_hash = public.decision_token_hash(p_device_token)
  where e.invite_code = upper(trim(p_invite_code));

  if target_event_id is null then raise exception 'Event not found'; end if;
  if not creator_valid then raise exception 'Only the event creator can set up availability'; end if;
  if p_end_date < p_start_date or p_end_date - p_start_date > 13 then
    raise exception 'Choose a date range of up to 14 days';
  end if;
  if p_start_hour < 0 or p_start_hour > 23 or p_end_hour < 1 or p_end_hour > 24 or p_end_hour <= p_start_hour then
    raise exception 'Choose a valid time range';
  end if;
  if p_slot_minutes not in (30, 60) then raise exception 'Time slots must be 30 or 60 minutes'; end if;
  if char_length(trim(p_timezone)) not between 1 and 80 then raise exception 'Choose a valid timezone'; end if;

  insert into public.decision_schedule_settings(
    event_id, start_date, end_date, start_hour, end_hour, slot_minutes, timezone, updated_at
  ) values (
    target_event_id, p_start_date, p_end_date, p_start_hour, p_end_hour, p_slot_minutes, trim(p_timezone), now()
  )
  on conflict (event_id) do update set
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    start_hour = excluded.start_hour,
    end_hour = excluded.end_hour,
    slot_minutes = excluded.slot_minutes,
    timezone = excluded.timezone,
    updated_at = now();

  delete from public.decision_schedule_availability a
  where a.event_id = target_event_id
    and (
      split_part(a.slot_key, '|', 1)::date < p_start_date
      or split_part(a.slot_key, '|', 1)::date > p_end_date
      or (
        extract(hour from split_part(a.slot_key, '|', 2)::time)::integer * 60
        + extract(minute from split_part(a.slot_key, '|', 2)::time)::integer
      ) < p_start_hour * 60
      or (
        extract(hour from split_part(a.slot_key, '|', 2)::time)::integer * 60
        + extract(minute from split_part(a.slot_key, '|', 2)::time)::integer
      ) >= p_end_hour * 60
      or mod((
        extract(hour from split_part(a.slot_key, '|', 2)::time)::integer * 60
        + extract(minute from split_part(a.slot_key, '|', 2)::time)::integer
      ) - p_start_hour * 60, p_slot_minutes) <> 0
    );
end;
$$;

create or replace function public.set_decision_schedule_availability(
  p_invite_code text,
  p_device_token text,
  p_slot_key text,
  p_preference integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  viewer_participant_id uuid;
  schedule public.decision_schedule_settings%rowtype;
  slot_date date;
  slot_time time;
  slot_minutes_of_day integer;
begin
  if p_preference not in (0, 1, 2) then raise exception 'Invalid availability preference'; end if;

  select e.id, p.id
  into target_event_id, viewer_participant_id
  from public.decision_events e
  join public.decision_participants p on p.event_id = e.id
  where e.invite_code = upper(trim(p_invite_code))
    and p.device_token_hash = public.decision_token_hash(p_device_token);

  if viewer_participant_id is null then raise exception 'Join this event before setting availability'; end if;

  select * into schedule
  from public.decision_schedule_settings
  where event_id = target_event_id;
  if schedule.event_id is null then raise exception 'Availability has not been set up yet'; end if;

  begin
    slot_date := split_part(p_slot_key, '|', 1)::date;
    slot_time := split_part(p_slot_key, '|', 2)::time;
  exception when others then
    raise exception 'Invalid time slot';
  end;

  slot_minutes_of_day := extract(hour from slot_time)::integer * 60 + extract(minute from slot_time)::integer;
  if slot_date < schedule.start_date or slot_date > schedule.end_date
    or slot_minutes_of_day < schedule.start_hour * 60
    or slot_minutes_of_day >= schedule.end_hour * 60
    or mod(slot_minutes_of_day - schedule.start_hour * 60, schedule.slot_minutes) <> 0 then
    raise exception 'That time is outside this availability grid';
  end if;

  if p_preference = 0 then
    delete from public.decision_schedule_availability
    where event_id = target_event_id
      and participant_id = viewer_participant_id
      and slot_key = p_slot_key;
  else
    insert into public.decision_schedule_availability(event_id, participant_id, slot_key, preference, updated_at)
    values (target_event_id, viewer_participant_id, p_slot_key, p_preference, now())
    on conflict (event_id, participant_id, slot_key) do update set
      preference = excluded.preference,
      updated_at = now();
  end if;
end;
$$;

create or replace function public.clear_decision_schedule_availability(
  p_invite_code text,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  viewer_participant_id uuid;
begin
  select e.id, p.id
  into target_event_id, viewer_participant_id
  from public.decision_events e
  join public.decision_participants p on p.event_id = e.id
  where e.invite_code = upper(trim(p_invite_code))
    and p.device_token_hash = public.decision_token_hash(p_device_token);

  if viewer_participant_id is null then raise exception 'Join this event before setting availability'; end if;

  delete from public.decision_schedule_availability
  where event_id = target_event_id and participant_id = viewer_participant_id;
end;
$$;

revoke execute on function public.get_decision_schedule(text, text) from public;
revoke execute on function public.setup_decision_schedule(text, text, date, date, integer, integer, integer, text) from public;
revoke execute on function public.set_decision_schedule_availability(text, text, text, integer) from public;
revoke execute on function public.clear_decision_schedule_availability(text, text) from public;

grant execute on function public.get_decision_schedule(text, text) to anon, authenticated;
grant execute on function public.setup_decision_schedule(text, text, date, date, integer, integer, integer, text) to anon, authenticated;
grant execute on function public.set_decision_schedule_availability(text, text, text, integer) to anon, authenticated;
grant execute on function public.clear_decision_schedule_availability(text, text) to anon, authenticated;
