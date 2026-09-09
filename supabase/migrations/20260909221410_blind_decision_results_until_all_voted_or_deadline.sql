alter table public.decision_events
  add column if not exists voting_deadline timestamptz,
  add column if not exists results_revealed_at timestamptz;

alter table public.decision_participants
  add column if not exists voted_at timestamptz;

create index if not exists decision_participants_event_voted_idx
  on public.decision_participants(event_id, voted_at);

-- Treat existing saved allocations as already-submitted votes.
update public.decision_participants p
set voted_at = prior.latest_vote
from (
  select participant_id, max(updated_at) as latest_vote
  from public.decision_allocations
  group by participant_id
) prior
where p.id = prior.participant_id
  and p.voted_at is null;

-- Existing decisions with at least two participants and a completed vote from everyone
-- are already eligible to show results.
update public.decision_events e
set results_revealed_at = coalesce(e.results_revealed_at, now())
where e.results_revealed_at is null
  and (select count(*) from public.decision_participants p where p.event_id = e.id) >= 2
  and not exists (
    select 1 from public.decision_participants p
    where p.event_id = e.id and p.voted_at is null
  );

drop function if exists public.create_decision_event(text, text[], text, text, date, boolean);

create function public.create_decision_event(
  p_question text,
  p_choices text[],
  p_display_name text,
  p_device_token text,
  p_event_date date default null,
  p_allow_guest_choices boolean default true,
  p_voting_deadline timestamptz default null
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
  if p_voting_deadline is not null and p_voting_deadline <= now() then
    raise exception 'Voting deadline must be in the future';
  end if;

  token_hash := public.decision_token_hash(p_device_token);
  new_invite_code := public.generate_decision_invite_code();

  insert into public.decision_events(
    question, invite_code, event_date, allow_guest_choices, creator_token_hash, voting_deadline
  ) values (
    clean_question, new_invite_code, p_event_date, coalesce(p_allow_guest_choices, true), token_hash, p_voting_deadline
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
  votes_submitted integer := 0;
  all_voted boolean := false;
  deadline_passed boolean := false;
  results_visible boolean := false;
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

  select count(*)::integer,
         count(*) filter (where voted_at is not null)::integer
  into participant_count, votes_submitted
  from public.decision_participants
  where event_id = target.id;

  all_voted := participant_count >= 2 and votes_submitted = participant_count;
  deadline_passed := target.voting_deadline is not null and now() >= target.voting_deadline;
  results_visible := target.results_revealed_at is not null or deadline_passed or all_voted;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ranked.id,
      'title', ranked.title,
      'total_chips', case when results_visible then ranked.total_chips else 0 end,
      'supporters', case when results_visible then ranked.supporters else 0 end
    ) order by
      case when results_visible then ranked.total_chips else 0 end desc,
      ranked.created_at asc
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
        'chips_spent', coalesce(spending.chips_spent, 0),
        'has_voted', p.voted_at is not null
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
    'voting_deadline', target.voting_deadline,
    'allow_guest_choices', target.allow_guest_choices,
    'participant_count', participant_count,
    'votes_submitted', votes_submitted,
    'results_visible', results_visible,
    'voting_closed', results_visible,
    'viewer', case when viewer.id is null then null else jsonb_build_object(
      'id', viewer.id,
      'display_name', viewer.display_name,
      'is_creator', viewer.is_creator,
      'chips_spent', spent,
      'chips_remaining', 100 - spent,
      'has_voted', viewer.voted_at is not null
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
  target public.decision_events%rowtype;
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

  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'Event not found'; end if;
  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    raise exception 'Voting has ended for this event';
  end if;

  token_hash := public.decision_token_hash(p_device_token);
  insert into public.decision_participants(event_id, display_name, device_token_hash)
  values (target.id, clean_name, token_hash)
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
  target public.decision_events%rowtype;
  viewer_participant_id uuid;
  requested_total integer;
  requested_count integer;
  participant_count integer;
  votes_submitted integer;
begin
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'Participant identity missing';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Invalid chip allocation';
  end if;

  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'Event not found'; end if;
  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    raise exception 'Voting has ended for this event';
  end if;

  select p.id into viewer_participant_id
  from public.decision_participants p
  where p.event_id = target.id
    and p.device_token_hash = public.decision_token_hash(p_device_token)
  for update;

  if viewer_participant_id is null then raise exception 'Join this event before voting'; end if;

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
      on c.id = (item ->> 'choice_id')::uuid and c.event_id = target.id
    where (item ->> 'chips')::integer > 0 and c.id is null
  ) then
    raise exception 'One of those choices is not part of this event';
  end if;

  delete from public.decision_allocations
  where event_id = target.id and participant_id = viewer_participant_id;

  insert into public.decision_allocations(event_id, participant_id, choice_id, chips)
  select target.id, viewer_participant_id, (item ->> 'choice_id')::uuid, (item ->> 'chips')::integer
  from jsonb_array_elements(p_allocations) item
  where (item ->> 'chips')::integer > 0;

  update public.decision_participants
  set voted_at = now()
  where id = viewer_participant_id and event_id = target.id;

  select count(*)::integer,
         count(*) filter (where voted_at is not null)::integer
  into participant_count, votes_submitted
  from public.decision_participants
  where event_id = target.id;

  if participant_count >= 2 and votes_submitted = participant_count then
    update public.decision_events
    set results_revealed_at = coalesce(results_revealed_at, now())
    where id = target.id;
  end if;
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
  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    raise exception 'Voting has ended for this event';
  end if;

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
  target public.decision_events%rowtype;
  creator_is_valid boolean;
  participant_count integer;
  votes_submitted integer;
begin
  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'Event not found'; end if;
  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    raise exception 'Voting has ended for this event';
  end if;

  select exists(
    select 1 from public.decision_participants owner
    where owner.event_id = target.id
      and owner.is_creator
      and owner.device_token_hash = public.decision_token_hash(p_device_token)
  ) into creator_is_valid;

  if not creator_is_valid then raise exception 'Only the event creator can remove participants'; end if;
  if exists (
    select 1 from public.decision_participants
    where id = p_participant_id and event_id = target.id and is_creator
  ) then
    raise exception 'The event creator cannot be removed';
  end if;

  delete from public.decision_participants
  where id = p_participant_id and event_id = target.id;

  select count(*)::integer,
         count(*) filter (where voted_at is not null)::integer
  into participant_count, votes_submitted
  from public.decision_participants
  where event_id = target.id;

  if participant_count >= 2 and votes_submitted = participant_count then
    update public.decision_events
    set results_revealed_at = coalesce(results_revealed_at, now())
    where id = target.id;
  end if;
end;
$$;

revoke execute on function public.create_decision_event(text, text[], text, text, date, boolean, timestamptz) from public;
revoke execute on function public.get_decision_event(text, text) from public;
revoke execute on function public.join_decision_event(text, text, text) from public;
revoke execute on function public.save_decision_allocations(text, text, jsonb) from public;
revoke execute on function public.add_decision_choice(text, text, text) from public;
revoke execute on function public.remove_decision_participant(text, text, uuid) from public;

grant execute on function public.create_decision_event(text, text[], text, text, date, boolean, timestamptz) to anon, authenticated;
grant execute on function public.get_decision_event(text, text) to anon, authenticated;
grant execute on function public.join_decision_event(text, text, text) to anon, authenticated;
grant execute on function public.save_decision_allocations(text, text, jsonb) to anon, authenticated;
grant execute on function public.add_decision_choice(text, text, text) to anon, authenticated;
grant execute on function public.remove_decision_participant(text, text, uuid) to anon, authenticated;
