-- Standalone, no-account decisions. Browser-generated device tokens are hashed
-- before storage and every participant receives an independent 100-chip budget.

-- Preserve RLS for the legacy room view while the older signed-in flow remains available.
alter view if exists public.plan_scores set (security_invoker = true);

create table if not exists public.decision_events (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 1 and 160),
  invite_code text not null unique,
  event_date date,
  allow_guest_choices boolean not null default true,
  creator_token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.decision_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.decision_events(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  device_token_hash text not null,
  is_creator boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, device_token_hash),
  unique (event_id, id)
);

create table if not exists public.decision_choices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.decision_events(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  created_by_participant uuid references public.decision_participants(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, id)
);

create unique index if not exists decision_choices_unique_title_idx
  on public.decision_choices(event_id, lower(title));

create table if not exists public.decision_allocations (
  event_id uuid not null,
  participant_id uuid not null,
  choice_id uuid not null,
  chips integer not null check (chips between 1 and 100),
  updated_at timestamptz not null default now(),
  primary key (participant_id, choice_id),
  foreign key (event_id, participant_id)
    references public.decision_participants(event_id, id) on delete cascade,
  foreign key (event_id, choice_id)
    references public.decision_choices(event_id, id) on delete cascade
);

create index if not exists decision_participants_event_idx
  on public.decision_participants(event_id, created_at);
create index if not exists decision_choices_event_idx
  on public.decision_choices(event_id, created_at);
create index if not exists decision_allocations_event_choice_idx
  on public.decision_allocations(event_id, choice_id);

alter table public.decision_events enable row level security;
alter table public.decision_participants enable row level security;
alter table public.decision_choices enable row level security;
alter table public.decision_allocations enable row level security;

revoke all on table public.decision_events from anon, authenticated;
revoke all on table public.decision_participants from anon, authenticated;
revoke all on table public.decision_choices from anon, authenticated;
revoke all on table public.decision_allocations from anon, authenticated;

create or replace function public.decision_token_hash(p_device_token text)
returns text
language sql
immutable
set search_path = pg_catalog, public, extensions
as $$
  select encode(extensions.digest(p_device_token, 'sha256'), 'hex');
$$;

create or replace function public.generate_decision_invite_code()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (
      select 1 from public.decision_events where invite_code = candidate
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.create_decision_event(
  p_question text,
  p_choices text[],
  p_display_name text,
  p_device_token text,
  p_event_date date default null,
  p_allow_guest_choices boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  new_event_id uuid;
  new_participant_id uuid;
  new_invite_code text;
  clean_question text := trim(p_question);
  clean_name text := trim(p_display_name);
  clean_choice text;
  token_hash text;
begin
  if char_length(clean_question) not between 1 and 160 then
    raise exception 'Enter an event question';
  end if;
  if char_length(clean_name) not between 1 and 50 then
    raise exception 'Enter your display name';
  end if;
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'This browser could not create a participant identity';
  end if;
  if coalesce(array_length(p_choices, 1), 0) not between 2 and 20 then
    raise exception 'Add between 2 and 20 choices';
  end if;
  if exists (
    select 1 from unnest(p_choices) as choice(value)
    where char_length(trim(value)) not between 1 and 120
  ) then
    raise exception 'Each choice needs a name';
  end if;
  if (
    select count(*) from (
      select distinct lower(trim(value)) from unnest(p_choices) as choice(value)
    ) unique_choices
  ) <> array_length(p_choices, 1) then
    raise exception 'Each choice must be different';
  end if;

  token_hash := public.decision_token_hash(p_device_token);
  new_invite_code := public.generate_decision_invite_code();

  insert into public.decision_events(
    question, invite_code, event_date, allow_guest_choices, creator_token_hash
  ) values (
    clean_question, new_invite_code, p_event_date, coalesce(p_allow_guest_choices, true), token_hash
  ) returning id into new_event_id;

  insert into public.decision_participants(
    event_id, display_name, device_token_hash, is_creator
  ) values (
    new_event_id, clean_name, token_hash, true
  ) returning id into new_participant_id;

  foreach clean_choice in array p_choices loop
    insert into public.decision_choices(event_id, title, created_by_participant)
    values (new_event_id, trim(clean_choice), new_participant_id);
  end loop;

  return jsonb_build_object(
    'event_id', new_event_id,
    'invite_code', new_invite_code,
    'participant_id', new_participant_id
  );
end;
$$;

create or replace function public.get_decision_event(
  p_invite_code text,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, extensions
as $$
declare
  target public.decision_events%rowtype;
  token_hash text;
  viewer public.decision_participants%rowtype;
  choices jsonb;
  participants jsonb;
  viewer_allocations jsonb;
  spent integer := 0;
  participant_count integer := 0;
begin
  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code));

  if not found then
    raise exception 'Event not found';
  end if;

  if p_device_token is not null and char_length(p_device_token) between 32 and 200 then
    token_hash := public.decision_token_hash(p_device_token);
    select * into viewer
    from public.decision_participants
    where event_id = target.id and device_token_hash = token_hash;
  end if;

  select count(*)::integer into participant_count
  from public.decision_participants
  where event_id = target.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ranked.id,
      'title', ranked.title,
      'total_chips', ranked.total_chips,
      'supporters', ranked.supporters
    ) order by ranked.total_chips desc, ranked.created_at asc
  ), '[]'::jsonb)
  into choices
  from (
    select
      c.id,
      c.title,
      c.created_at,
      coalesce(sum(a.chips), 0)::integer as total_chips,
      count(a.participant_id)::integer as supporters
    from public.decision_choices c
    left join public.decision_allocations a
      on a.event_id = c.event_id and a.choice_id = c.id
    where c.event_id = target.id
    group by c.id, c.title, c.created_at
  ) ranked;

  if viewer.id is not null then
    select coalesce(sum(chips), 0)::integer into spent
    from public.decision_allocations
    where event_id = target.id and participant_id = viewer.id;

    select coalesce(jsonb_agg(
      jsonb_build_object('choice_id', choice_id, 'chips', chips)
    ), '[]'::jsonb)
    into viewer_allocations
    from public.decision_allocations
    where event_id = target.id and participant_id = viewer.id;
  else
    viewer_allocations := '[]'::jsonb;
  end if;

  if viewer.is_creator then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'is_creator', p.is_creator,
        'chips_spent', coalesce(spending.chips_spent, 0)
      ) order by p.is_creator desc, p.created_at asc
    ), '[]'::jsonb)
    into participants
    from public.decision_participants p
    left join (
      select participant_id, sum(chips)::integer as chips_spent
      from public.decision_allocations
      where event_id = target.id
      group by participant_id
    ) spending on spending.participant_id = p.id
    where p.event_id = target.id;
  else
    participants := null;
  end if;

  return jsonb_build_object(
    'id', target.id,
    'question', target.question,
    'invite_code', target.invite_code,
    'event_date', target.event_date,
    'allow_guest_choices', target.allow_guest_choices,
    'participant_count', participant_count,
    'viewer', case when viewer.id is null then null else jsonb_build_object(
      'id', viewer.id,
      'display_name', viewer.display_name,
      'is_creator', viewer.is_creator,
      'chips_spent', spent,
      'chips_remaining', 100 - spent
    ) end,
    'viewer_allocations', viewer_allocations,
    'choices', choices,
    'participants', participants
  );
end;
$$;

create or replace function public.join_decision_event(
  p_invite_code text,
  p_display_name text,
  p_device_token text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  participant_id uuid;
  clean_name text := trim(p_display_name);
  token_hash text;
begin
  if char_length(clean_name) not between 1 and 50 then
    raise exception 'Enter your display name';
  end if;
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'This browser could not create a participant identity';
  end if;

  select id into target_event_id
  from public.decision_events
  where invite_code = upper(trim(p_invite_code));
  if target_event_id is null then raise exception 'Event not found'; end if;

  token_hash := public.decision_token_hash(p_device_token);
  insert into public.decision_participants(event_id, display_name, device_token_hash)
  values (target_event_id, clean_name, token_hash)
  on conflict (event_id, device_token_hash)
  do update set display_name = excluded.display_name
  returning id into participant_id;

  return participant_id;
end;
$$;

create or replace function public.save_decision_allocations(
  p_invite_code text,
  p_device_token text,
  p_allocations jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  viewer_participant_id uuid;
  requested_total integer;
  requested_count integer;
begin
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'Participant identity missing';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Invalid chip allocation';
  end if;

  select e.id, p.id into target_event_id, viewer_participant_id
  from public.decision_events e
  join public.decision_participants p on p.event_id = e.id
  where e.invite_code = upper(trim(p_invite_code))
    and p.device_token_hash = public.decision_token_hash(p_device_token);

  if viewer_participant_id is null then raise exception 'Join this event before voting'; end if;

  perform 1 from public.decision_participants where id = viewer_participant_id for update;

  with requested as (
    select (item ->> 'choice_id')::uuid as choice_id,
           (item ->> 'chips')::integer as chips
    from jsonb_array_elements(p_allocations) item
  )
  select coalesce(sum(chips), 0)::integer, count(*)::integer
  into requested_total, requested_count
  from requested
  where chips > 0;

  if requested_total > 100 then raise exception 'You only have 100 chips for this event'; end if;
  if exists (
    select 1
    from jsonb_array_elements(p_allocations) item
    where (item ->> 'chips')::integer < 0
       or (item ->> 'chips')::integer > 100
  ) then
    raise exception 'Each chip amount must be between 0 and 100';
  end if;
  if requested_count <> (
    select count(distinct (item ->> 'choice_id'))
    from jsonb_array_elements(p_allocations) item
    where (item ->> 'chips')::integer > 0
  ) then
    raise exception 'A choice can only appear once';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_allocations) item
    left join public.decision_choices c
      on c.id = (item ->> 'choice_id')::uuid and c.event_id = target_event_id
    where (item ->> 'chips')::integer > 0 and c.id is null
  ) then
    raise exception 'One of those choices is not part of this event';
  end if;

  delete from public.decision_allocations
  where event_id = target_event_id and participant_id = viewer_participant_id;

  insert into public.decision_allocations(event_id, participant_id, choice_id, chips)
  select target_event_id, viewer_participant_id, (item ->> 'choice_id')::uuid, (item ->> 'chips')::integer
  from jsonb_array_elements(p_allocations) item
  where (item ->> 'chips')::integer > 0;
end;
$$;

create or replace function public.add_decision_choice(
  p_invite_code text,
  p_device_token text,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target public.decision_events%rowtype;
  participant public.decision_participants%rowtype;
  new_choice_id uuid;
  clean_title text := trim(p_title);
begin
  if char_length(clean_title) not between 1 and 120 then
    raise exception 'Enter a choice';
  end if;

  select * into target from public.decision_events
  where invite_code = upper(trim(p_invite_code));
  if not found then raise exception 'Event not found'; end if;

  select * into participant from public.decision_participants
  where event_id = target.id
    and device_token_hash = public.decision_token_hash(p_device_token);
  if participant.id is null then raise exception 'Join this event first'; end if;
  if not target.allow_guest_choices and not participant.is_creator then
    raise exception 'Only the event creator can add choices';
  end if;
  if (select count(*) from public.decision_choices where event_id = target.id) >= 25 then
    raise exception 'This event already has the maximum of 25 choices';
  end if;

  insert into public.decision_choices(event_id, title, created_by_participant)
  values (target.id, clean_title, participant.id)
  returning id into new_choice_id;
  return new_choice_id;
exception
  when unique_violation then raise exception 'That choice is already listed';
end;
$$;

create or replace function public.remove_decision_participant(
  p_invite_code text,
  p_device_token text,
  p_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target_event_id uuid;
  creator_is_valid boolean;
begin
  select e.id, exists(
    select 1 from public.decision_participants owner
    where owner.event_id = e.id
      and owner.is_creator
      and owner.device_token_hash = public.decision_token_hash(p_device_token)
  )
  into target_event_id, creator_is_valid
  from public.decision_events e
  where e.invite_code = upper(trim(p_invite_code));

  if target_event_id is null then raise exception 'Event not found'; end if;
  if not creator_is_valid then raise exception 'Only the event creator can remove participants'; end if;
  if exists (
    select 1 from public.decision_participants
    where id = p_participant_id and event_id = target_event_id and is_creator
  ) then
    raise exception 'The event creator cannot be removed';
  end if;

  delete from public.decision_participants
  where id = p_participant_id and event_id = target_event_id;
end;
$$;

revoke execute on function public.decision_token_hash(text) from public, anon, authenticated;
revoke execute on function public.generate_decision_invite_code() from public, anon, authenticated;

revoke execute on function public.create_decision_event(text, text[], text, text, date, boolean) from public;
revoke execute on function public.get_decision_event(text, text) from public;
revoke execute on function public.join_decision_event(text, text, text) from public;
revoke execute on function public.save_decision_allocations(text, text, jsonb) from public;
revoke execute on function public.add_decision_choice(text, text, text) from public;
revoke execute on function public.remove_decision_participant(text, text, uuid) from public;

grant execute on function public.create_decision_event(text, text[], text, text, date, boolean) to anon, authenticated;
grant execute on function public.get_decision_event(text, text) to anon, authenticated;
grant execute on function public.join_decision_event(text, text, text) to anon, authenticated;
grant execute on function public.save_decision_allocations(text, text, jsonb) to anon, authenticated;
grant execute on function public.add_decision_choice(text, text, text) to anon, authenticated;
grant execute on function public.remove_decision_participant(text, text, uuid) to anon, authenticated;
