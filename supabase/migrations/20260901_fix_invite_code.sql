-- Fix group creation on Supabase projects where pgcrypto functions are not on the public search path.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.groups where invite_code = candidate
    );
  end loop;

  return candidate;
end;
$$;
