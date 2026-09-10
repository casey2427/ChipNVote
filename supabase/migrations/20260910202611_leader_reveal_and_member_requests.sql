create table if not exists public.decision_reveal_requests (
  event_id uuid not null,
  participant_id uuid not null,
  requested_at timestamptz not null default now(),
  primary key (event_id, participant_id),
  foreign key (event_id) references public.decision_events(id) on delete cascade,
  foreign key (event_id, participant_id)
    references public.decision_participants(event_id, id) on delete cascade
);

create index if not exists decision_reveal_requests_event_idx
  on public.decision_reveal_requests(event_id, requested_at);

alter table public.decision_reveal_requests enable row level security;
revoke all on table public.decision_reveal_requests from anon, authenticated;

-- Prior to this migration, results_revealed_at was filled automatically when
-- every participant had submitted. Reopen events whose deadline has not passed.
update public.decision_events
set results_revealed_at = null
where results_revealed_at is not null
  and (voting_deadline is null or now() < voting_deadline);

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
  reveal_request_count integer := 0;
  viewer_requested_reveal boolean := false;
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

  select count(*)::integer
  into reveal_request_count
  from public.decision_reveal_requests
  where event_id = target.id;

  if viewer.id is not null then
    select exists(
      select 1
      from public.decision_reveal_requests r
      where r.event_id = target.id
        and r.participant_id = viewer.id
    ) into viewer_requested_reveal;
  end if;

  deadline_passed := target.voting_deadline is not null and now() >= target.voting_deadline;
  results_visible := target.results_revealed_at is not null or deadline_passed;

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
        'has_voted', p.voted_at is not null,
        'requested_reveal', requests.participant_id is not null
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
    left join public.decision_reveal_requests requests
      on requests.event_id = p.event_id
     and requests.participant_id = p.id
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
    'reveal_request_count', reveal_request_count,
    'viewer_requested_reveal', viewer_requested_reveal,
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
end;
$$;

create or replace function public.request_decision_results_reveal(
  p_invite_code text,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target public.decision_events%rowtype;
  viewer public.decision_participants%rowtype;
begin
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'Participant identity missing';
  end if;

  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'Event not found'; end if;
  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    raise exception 'Results are already available';
  end if;

  select * into viewer
  from public.decision_participants
  where event_id = target.id
    and device_token_hash = public.decision_token_hash(p_device_token);

  if viewer.id is null then raise exception 'Join this event first'; end if;
  if viewer.is_creator then raise exception 'The event creator can reveal results directly'; end if;
  if viewer.voted_at is null then raise exception 'Submit your vote before requesting results'; end if;

  insert into public.decision_reveal_requests(event_id, participant_id)
  values (target.id, viewer.id)
  on conflict (event_id, participant_id) do nothing;
end;
$$;

create or replace function public.reveal_decision_results(
  p_invite_code text,
  p_device_token text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  target public.decision_events%rowtype;
  creator_is_valid boolean := false;
begin
  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'Participant identity missing';
  end if;

  select * into target
  from public.decision_events
  where invite_code = upper(trim(p_invite_code))
  for update;

  if not found then raise exception 'Event not found'; end if;

  select exists(
    select 1
    from public.decision_participants p
    where p.event_id = target.id
      and p.is_creator
      and p.device_token_hash = public.decision_token_hash(p_device_token)
  ) into creator_is_valid;

  if not creator_is_valid then
    raise exception 'Only the event creator can reveal results';
  end if;

  if target.results_revealed_at is not null
     or (target.voting_deadline is not null and now() >= target.voting_deadline) then
    return;
  end if;

  if not exists (
    select 1
    from public.decision_participants p
    where p.event_id = target.id
      and p.voted_at is not null
  ) then
    raise exception 'Wait until at least one vote is submitted';
  end if;

  update public.decision_events
  set results_revealed_at = now()
  where id = target.id;
end;
$$;

revoke execute on function public.get_decision_event(text, text) from public;
revoke execute on function public.save_decision_allocations(text, text, jsonb) from public;
revoke execute on function public.remove_decision_participant(text, text, uuid) from public;
revoke execute on function public.request_decision_results_reveal(text, text) from public;
revoke execute on function public.reveal_decision_results(text, text) from public;

grant execute on function public.get_decision_event(text, text) to anon, authenticated;
grant execute on function public.save_decision_allocations(text, text, jsonb) to anon, authenticated;
grant execute on function public.remove_decision_participant(text, text, uuid) to anon, authenticated;
grant execute on function public.request_decision_results_reveal(text, text) to anon, authenticated;
grant execute on function public.reveal_decision_results(text, text) to anon, authenticated;
