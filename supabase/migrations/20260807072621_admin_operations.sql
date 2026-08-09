begin;

-- Administrator lifecycle metadata is additive. Existing bootstrap-created
-- memberships remain valid and are classified as LEGACY.
alter table public.admin_memberships
  add column if not exists grant_source text not null default 'LEGACY',
  add column if not exists granted_by uuid references auth.users(id) on delete set null,
  add column if not exists deactivated_by uuid references auth.users(id) on delete set null,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_memberships'::regclass
      and conname = 'admin_memberships_grant_source_check'
  ) then
    alter table public.admin_memberships
      add constraint admin_memberships_grant_source_check
      check (grant_source in ('LEGACY', 'BOOTSTRAP', 'ENV_ALLOWLIST', 'ADMIN_UI', 'CLI'))
      not valid;
    alter table public.admin_memberships
      validate constraint admin_memberships_grant_source_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.admin_memberships'::regclass
      and conname = 'admin_memberships_deactivation_reason_check'
  ) then
    alter table public.admin_memberships
      add constraint admin_memberships_deactivation_reason_check
      check (
        deactivation_reason is null
        or char_length(deactivation_reason) between 1 and 500
      ) not valid;
    alter table public.admin_memberships
      validate constraint admin_memberships_deactivation_reason_check;
  end if;
end;
$$;

create index if not exists admin_memberships_active_permissions_idx
  on public.admin_memberships(is_active)
  where is_active;

-- Called only after the application has compared the authenticated, verified
-- email with ADMIN_EMAILS. This function independently verifies the Auth user
-- and never reactivates a membership that an administrator deliberately
-- disabled.
create or replace function public.provision_configured_admin(
  p_user_id uuid,
  p_expected_email text,
  p_grant_source text default 'ENV_ALLOWLIST'
)
returns public.admin_memberships
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_actual_email text;
  v_membership public.admin_memberships%rowtype;
begin
  if p_user_id is null
     or p_expected_email is null
     or char_length(trim(p_expected_email)) not between 3 and 254
     or p_grant_source not in ('ENV_ALLOWLIST', 'CLI') then
    raise exception 'invalid_configured_admin' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hometogether-configured-admin:' || p_user_id::text, 0)
  );

  select lower(email) into v_actual_email
  from auth.users
  where id = p_user_id
    and email_confirmed_at is not null;

  if v_actual_email is null
     or v_actual_email <> lower(trim(p_expected_email)) then
    raise exception 'configured_admin_user_mismatch' using errcode = '42501';
  end if;

  select * into v_membership
  from public.admin_memberships
  where user_id = p_user_id
  for update;

  if found then
    -- Inactive is authoritative: environment membership cannot silently undo
    -- an explicit administrator deactivation.
    return v_membership;
  end if;

  insert into public.admin_memberships (
    user_id, permissions, is_active, grant_source
  ) values (
    p_user_id, array['SUPER_ADMIN']::text[], true, p_grant_source
  )
  returning * into v_membership;

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_user_id,
    'ADMIN_MEMBERSHIP',
    p_user_id,
    case when p_grant_source = 'CLI' then 'CLI_GRANT_ADMIN' else 'ENV_ALLOWLIST_GRANT_ADMIN' end,
    null,
    jsonb_build_object(
      'permissions', v_membership.permissions,
      'isActive', v_membership.is_active,
      'grantSource', v_membership.grant_source
    )
  );

  return v_membership;
end;
$$;

-- Existing SUPER_ADMINs manage memberships through this transaction. The
-- advisory lock and final-super check prevent concurrent demotions from
-- leaving Production without an administrator.
create or replace function public.admin_set_membership(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_permissions text[],
  p_is_active boolean,
  p_reason text default null
)
returns public.admin_memberships
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_verified boolean;
  v_before public.admin_memberships%rowtype;
  v_after public.admin_memberships%rowtype;
  v_before_json jsonb;
  v_after_json jsonb;
begin
  if not public.admin_has_permission(p_actor_id, 'SUPER_ADMIN') then
    raise exception 'admin_management_forbidden' using errcode = '42501';
  end if;

  if p_target_user_id is null
     or p_permissions is null
     or cardinality(p_permissions) = 0
     or not (
       p_permissions <@ array[
         'CHECKIN_READ', 'SAFETY_READ', 'CASE_WRITE', 'SUPER_ADMIN'
       ]::text[]
     )
     or (p_reason is not null and char_length(trim(p_reason)) not between 1 and 500) then
    raise exception 'invalid_admin_membership' using errcode = '22023';
  end if;

  select exists (
    select 1 from auth.users
    where id = p_target_user_id and email_confirmed_at is not null
  ) into v_verified;
  if not v_verified then
    raise exception 'admin_target_not_verified' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('hometogether-admin-memberships', 0)
  );

  select * into v_before
  from public.admin_memberships
  where user_id = p_target_user_id
  for update;

  if found
     and v_before.is_active
     and 'SUPER_ADMIN' = any(v_before.permissions)
     and (not p_is_active or not ('SUPER_ADMIN' = any(p_permissions)))
     and not exists (
       select 1
       from public.admin_memberships other_admin
       where other_admin.user_id <> p_target_user_id
         and other_admin.is_active
         and 'SUPER_ADMIN' = any(other_admin.permissions)
     ) then
    raise exception 'last_super_admin_protected' using errcode = '23514';
  end if;

  v_before_json := case when v_before.user_id is null then null else jsonb_build_object(
    'permissions', v_before.permissions,
    'isActive', v_before.is_active,
    'grantSource', v_before.grant_source
  ) end;

  insert into public.admin_memberships (
    user_id,
    permissions,
    is_active,
    grant_source,
    granted_by,
    deactivated_by,
    deactivated_at,
    deactivation_reason
  ) values (
    p_target_user_id,
    p_permissions,
    p_is_active,
    'ADMIN_UI',
    p_actor_id,
    case when p_is_active then null else p_actor_id end,
    case when p_is_active then null else clock_timestamp() end,
    case when p_is_active then null else nullif(trim(p_reason), '') end
  )
  on conflict (user_id) do update
  set permissions = excluded.permissions,
      is_active = excluded.is_active,
      deactivated_by = excluded.deactivated_by,
      deactivated_at = excluded.deactivated_at,
      deactivation_reason = excluded.deactivation_reason
  returning * into v_after;

  v_after_json := jsonb_build_object(
    'permissions', v_after.permissions,
    'isActive', v_after.is_active,
    'grantSource', v_after.grant_source
  );

  insert into public.audit_logs (
    admin_id, entity_type, entity_id, action, before_json, after_json
  ) values (
    p_actor_id,
    'ADMIN_MEMBERSHIP',
    p_target_user_id,
    case
      when v_before.user_id is null then 'ADD_ADMIN'
      when p_is_active and not v_before.is_active then 'REACTIVATE_ADMIN'
      when not p_is_active then 'DEACTIVATE_ADMIN'
      else 'UPDATE_ADMIN_PERMISSIONS'
    end,
    v_before_json,
    v_after_json
  );

  return v_after;
end;
$$;

revoke all on function public.provision_configured_admin(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.provision_configured_admin(uuid, text, text)
  to service_role;

revoke all on function public.admin_set_membership(uuid, uuid, text[], boolean, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_membership(uuid, uuid, text[], boolean, text)
  to service_role;

commit;
