create or replace function public.create_decision_schedule_event(
  p_question text,
  p_display_name text,
  p_device_token text
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
  token_hash text;
begin
  if char_length(clean_question) not between 1 and 160 then
    raise exception 'Enter what you are scheduling';
  end if;

  if char_length(clean_name) not between 1 and 50 then
    raise exception 'Enter your display name';
  end if;

  if p_device_token is null or char_length(p_device_token) not between 32 and 200 then
    raise exception 'This browser could not create a participant identity';
  end if;

  token_hash := public.decision_token_hash(p_device_token);
  new_invite_code := public.generate_decision_invite_code();

  insert into public.decision_events(
    question,
    invite_code,
    event_date,
    allow_guest_choices,
    creator_token_hash
  ) values (
    clean_question,
    new_invite_code,
    null,
    false,
    token_hash
  )
  returning id into new_event_id;

  insert into public.decision_participants(
    event_id,
    display_name,
    device_token_hash,
    is_creator
  ) values (
    new_event_id,
    clean_name,
    token_hash,
    true
  )
  returning id into new_participant_id;

  return jsonb_build_object(
    'event_id', new_event_id,
    'invite_code', new_invite_code,
    'participant_id', new_participant_id
  );
end;
$$;

revoke execute on function public.create_decision_schedule_event(text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_decision_schedule_event(text, text, text)
  to anon, authenticated;
