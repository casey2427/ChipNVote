
create or replace function public.set_decision_schedule_availability_bulk(
  p_invite_code text,
  p_device_token text,
  p_updates jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  item jsonb;
  update_count integer;
  slot_key_value text;
  preference_value integer;
begin
  if jsonb_typeof(p_updates) <> 'array' then
    raise exception 'Invalid availability updates';
  end if;

  update_count := jsonb_array_length(p_updates);
  if update_count < 1 or update_count > 700 then
    raise exception 'Choose between 1 and 700 time slots';
  end if;

  for item in select value from jsonb_array_elements(p_updates)
  loop
    if jsonb_typeof(item) <> 'object'
      or not (item ? 'slot_key')
      or not (item ? 'preference') then
      raise exception 'Invalid availability update';
    end if;

    slot_key_value := item ->> 'slot_key';

    begin
      preference_value := (item ->> 'preference')::integer;
    exception when others then
      raise exception 'Invalid availability preference';
    end;

    perform public.set_decision_schedule_availability(
      p_invite_code,
      p_device_token,
      slot_key_value,
      preference_value
    );
  end loop;
end;
$$;

revoke execute on function public.set_decision_schedule_availability_bulk(text, text, jsonb) from public;
grant execute on function public.set_decision_schedule_availability_bulk(text, text, jsonb) to anon, authenticated;
