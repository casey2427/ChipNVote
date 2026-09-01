-- Restrict SECURITY DEFINER functions to their intended callers.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_group_member(uuid) from public, anon, authenticated;

revoke execute on function public.create_group(text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.set_plan_vote(uuid, integer) from public, anon;
revoke execute on function public.toggle_super_vote(uuid) from public, anon;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.set_plan_vote(uuid, integer) to authenticated;
grant execute on function public.toggle_super_vote(uuid) to authenticated;
