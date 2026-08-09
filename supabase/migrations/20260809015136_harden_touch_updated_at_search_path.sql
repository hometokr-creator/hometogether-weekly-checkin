-- The trigger body only needs catalog functions and objects from public.
-- Pinning the path removes the mutable-search-path advisor finding without
-- changing any trigger or table behavior.
do $migration$
begin
  -- The weekly-checkin repository can also be replayed into a fresh project
  -- without the legacy HomeTogether schema, where this function is absent.
  if to_regprocedure('public.touch_updated_at()') is null then
    return;
  end if;

  execute 'alter function public.touch_updated_at() set search_path = pg_catalog, public';

  -- Trigger functions cannot be invoked as ordinary SQL functions. Existing
  -- triggers continue to execute as before, while direct API roles do not need
  -- an EXECUTE grant on the function itself.
  execute 'revoke execute on function public.touch_updated_at() from public, anon, authenticated';
  execute 'grant execute on function public.touch_updated_at() to service_role';
end
$migration$;

-- Supabase historically grants new public objects to Data API roles. Make
-- migrations fail closed by default; each application migration must grant
-- only the privileges it actually needs. Keep service_role defaults intact.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public, anon, authenticated;

-- Cache auth.uid() once per statement instead of re-evaluating it for every
-- row. Policy semantics and the existing admin permission checks are unchanged.
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or public.is_admin('CHECKIN_READ')
  );

drop policy if exists admin_memberships_select_self on public.admin_memberships;
create policy admin_memberships_select_self on public.admin_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));
