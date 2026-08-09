-- The legacy app_files table pre-dates the weekly-checkin service. Its policy
-- named "delete for active members" was accidentally created as PUBLIC ALL
-- with no USING/WITH CHECK expression, which bypassed every other policy.
-- Keep this migration replayable in a standalone weekly-checkin project.
do $migration$
begin
  if to_regclass('public.app_files') is null then
    return;
  end if;

  if to_regclass('public.app_members') is null
     or to_regprocedure('public.is_app_member(uuid)') is null
     or to_regprocedure('public.can_edit_app(uuid)') is null then
    raise exception 'LEGACY_APP_FILES_RLS_PRECONDITION_FAILED';
  end if;

  execute 'alter table public.app_files enable row level security';

  execute 'drop policy if exists "app files delete for active members" on public.app_files';
  execute 'drop policy if exists "app files select for active members" on public.app_files';
  execute 'drop policy if exists "app files insert for active members" on public.app_files';
  execute 'drop policy if exists "app files update for active members" on public.app_files';

  execute $policy$
    create policy "app files select for active members"
      on public.app_files for select to authenticated
      using (public.is_app_member((select auth.uid())))
  $policy$;

  execute $policy$
    create policy "app files insert for active members"
      on public.app_files for insert to authenticated
      with check (public.can_edit_app((select auth.uid())))
  $policy$;

  execute $policy$
    create policy "app files update for active members"
      on public.app_files for update to authenticated
      using (public.can_edit_app((select auth.uid())))
      with check (public.can_edit_app((select auth.uid())))
  $policy$;

  execute $policy$
    create policy "app files delete for active members"
      on public.app_files for delete to authenticated
      using (public.can_edit_app((select auth.uid())))
  $policy$;

  execute 'revoke all privileges on table public.app_files from anon';
  execute 'revoke all privileges on table public.app_files from authenticated';
  execute 'grant select, insert, update, delete on table public.app_files to authenticated';
end
$migration$;
