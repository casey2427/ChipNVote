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
      'supporters', case when results_visible then ranked.supporters else 0 end,
      'voters', case
        when results_visible and viewer.id is not null then ranked.voters
        else '[]'::jsonb
      end
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
      count(a.participant_id)::integer as supporters,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'participant_id', voter.id,
            'display_name', voter.display_name,
            'chips', vote.chips
          )
          order by vote.chips desc, voter.created_at asc
        )
        from public.decision_allocations vote
        join public.decision_participants voter
          on voter.event_id = vote.event_id
         and voter.id = vote.participant_id
        where vote.event_id = c.event_id
          and vote.choice_id = c.id
      ), '[]'::jsonb) as voters
    from public.decision_choices c
    left join public.decision_allocations a
      on a.event_id = c.event_id and a.choice_id = c.id
    where c.event_id = target.id
    group by c.id, c.title, c.created_at, c.event_id
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

revoke execute on function public.get_decision_event(text, text) from public;
grant execute on function public.get_decision_event(text, text) to anon, authenticated;
