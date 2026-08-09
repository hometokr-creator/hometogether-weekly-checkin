-- Keep the legacy member/record API available to signed-in users while
-- removing anonymous table grants and anonymous SECURITY DEFINER RPC oracles.
-- A standalone weekly-checkin project does not contain these legacy objects.
do $migration$
begin
  if to_regclass('public.app_members') is null
     and to_regclass('public.app_records') is null then
    return;
  end if;

  if to_regclass('public.app_members') is null
     or to_regclass('public.app_records') is null
     or to_regprocedure('public.is_app_member(uuid)') is null
     or to_regprocedure('public.can_edit_app(uuid)') is null then
    raise exception 'LEGACY_MEMBER_HELPER_PRECONDITION_FAILED';
  end if;

  execute 'drop policy if exists "app members can read members" on public.app_members';
  execute $policy$
    create policy "app members can read members"
      on public.app_members for select to authenticated
      using (
        user_id = (select auth.uid())
        or public.is_app_member((select auth.uid()))
      )
  $policy$;

  execute 'drop policy if exists "app records read for members" on public.app_records';
  execute 'drop policy if exists "app records write for active members" on public.app_records';
  execute 'drop policy if exists "app records insert for active editors" on public.app_records';
  execute 'drop policy if exists "app records update for active editors" on public.app_records';
  execute 'drop policy if exists "app records delete for active editors" on public.app_records';

  execute $policy$
    create policy "app records read for members"
      on public.app_records for select to authenticated
      using (public.is_app_member((select auth.uid())))
  $policy$;
  execute $policy$
    create policy "app records insert for active editors"
      on public.app_records for insert to authenticated
      with check (public.can_edit_app((select auth.uid())))
  $policy$;
  execute $policy$
    create policy "app records update for active editors"
      on public.app_records for update to authenticated
      using (public.can_edit_app((select auth.uid())))
      with check (public.can_edit_app((select auth.uid())))
  $policy$;
  execute $policy$
    create policy "app records delete for active editors"
      on public.app_records for delete to authenticated
      using (public.can_edit_app((select auth.uid())))
  $policy$;

  execute 'revoke all privileges on table public.app_members from anon';
  execute 'revoke all privileges on table public.app_members from authenticated';
  execute 'grant select on table public.app_members to authenticated';

  execute 'revoke all privileges on table public.app_records from anon';
  execute 'revoke all privileges on table public.app_records from authenticated';
  execute 'grant select, insert, update, delete on table public.app_records to authenticated';

  execute 'revoke execute on function public.is_app_member(uuid) from public, anon';
  execute 'revoke execute on function public.can_edit_app(uuid) from public, anon';
  execute 'grant execute on function public.is_app_member(uuid) to authenticated, service_role';
  execute 'grant execute on function public.can_edit_app(uuid) to authenticated, service_role';
end
$migration$;

-- These legacy foreign keys are small today, but covering indexes avoid full
-- scans when referenced Auth or university rows are updated or deleted.
do $indexes$
begin
  if to_regclass('public.app_files') is not null then
    execute 'create index if not exists app_files_created_by_idx on public.app_files(created_by)';
  end if;
  if to_regclass('public.app_records') is not null then
    execute 'create index if not exists app_records_created_by_idx on public.app_records(created_by)';
    execute 'create index if not exists app_records_updated_by_idx on public.app_records(updated_by)';
  end if;
  if to_regclass('public.student_email_verifications') is not null then
    execute 'create index if not exists student_email_verifications_university_id_idx on public.student_email_verifications(university_id)';
  end if;
end
$indexes$;
