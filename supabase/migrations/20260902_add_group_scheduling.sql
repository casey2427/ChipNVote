create table if not exists public.group_schedule_settings (
  group_id uuid primary key references public.groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
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

create table if not exists public.schedule_availability (
  group_id uuid not null,
  user_id uuid not null,
  slot_key text not null check (char_length(slot_key) between 10 and 32),
  preference smallint not null check (preference in (1, 2)),
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id, slot_key),
  foreign key (group_id, user_id) references public.group_members(group_id, user_id) on delete cascade
);

create index if not exists schedule_availability_group_idx on public.schedule_availability(group_id);
create index if not exists schedule_availability_user_idx on public.schedule_availability(group_id, user_id);

alter table public.group_schedule_settings enable row level security;
alter table public.schedule_availability enable row level security;

drop policy if exists "Members view schedule settings" on public.group_schedule_settings;
create policy "Members view schedule settings" on public.group_schedule_settings for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "Owners create schedule settings" on public.group_schedule_settings;
create policy "Owners create schedule settings" on public.group_schedule_settings for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.group_members gm where gm.group_id = group_schedule_settings.group_id and gm.user_id = (select auth.uid()) and gm.role = 'owner'
  )
);

drop policy if exists "Owners update schedule settings" on public.group_schedule_settings;
create policy "Owners update schedule settings" on public.group_schedule_settings for update to authenticated using (
  exists (select 1 from public.group_members gm where gm.group_id = group_schedule_settings.group_id and gm.user_id = (select auth.uid()) and gm.role = 'owner')
) with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.group_members gm where gm.group_id = group_schedule_settings.group_id and gm.user_id = (select auth.uid()) and gm.role = 'owner'
  )
);

drop policy if exists "Owners delete schedule settings" on public.group_schedule_settings;
create policy "Owners delete schedule settings" on public.group_schedule_settings for delete to authenticated using (
  exists (select 1 from public.group_members gm where gm.group_id = group_schedule_settings.group_id and gm.user_id = (select auth.uid()) and gm.role = 'owner')
);

drop policy if exists "Members view schedule availability" on public.schedule_availability;
create policy "Members view schedule availability" on public.schedule_availability for select to authenticated using (public.is_group_member(group_id));

drop policy if exists "Members add own schedule availability" on public.schedule_availability;
create policy "Members add own schedule availability" on public.schedule_availability for insert to authenticated with check (
  user_id = (select auth.uid()) and public.is_group_member(group_id)
);

drop policy if exists "Members update own schedule availability" on public.schedule_availability;
create policy "Members update own schedule availability" on public.schedule_availability for update to authenticated using (
  user_id = (select auth.uid()) and public.is_group_member(group_id)
) with check (
  user_id = (select auth.uid()) and public.is_group_member(group_id)
);

drop policy if exists "Members delete own schedule availability" on public.schedule_availability;
create policy "Members delete own schedule availability" on public.schedule_availability for delete to authenticated using (
  user_id = (select auth.uid()) and public.is_group_member(group_id)
);

revoke all on table public.group_schedule_settings from anon, authenticated;
revoke all on table public.schedule_availability from anon, authenticated;
grant select, insert, update, delete on table public.group_schedule_settings to authenticated;
grant select, insert, update, delete on table public.schedule_availability to authenticated;
