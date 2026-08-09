create extension if not exists pgcrypto;

create table if not exists public.hometogether_rule_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

insert into public.hometogether_rule_admins (user_id, email)
select id, lower(email)
from auth.users
where lower(email) = 'hometo.kr@gmail.com'
on conflict (user_id) do update set email = excluded.email;

create table if not exists public.hometogether_rule_sessions (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  host_token uuid not null unique default gen_random_uuid(),
  guest_token uuid not null unique default gen_random_uuid(),
  token_expires_at timestamptz not null default now() + interval '30 days',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(state::text) <= 250000)
);

alter table public.hometogether_rule_admins enable row level security;
alter table public.hometogether_rule_sessions enable row level security;

create or replace function public.hometogether_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hometogether_rule_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.hometogether_is_admin() from public;
grant execute on function public.hometogether_is_admin() to authenticated;

drop policy if exists "hometogether admins read sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins read sessions"
on public.hometogether_rule_sessions for select to authenticated
using (public.hometogether_is_admin());

drop policy if exists "hometogether admins create sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins create sessions"
on public.hometogether_rule_sessions for insert to authenticated
with check (public.hometogether_is_admin() and created_by = auth.uid());

drop policy if exists "hometogether admins update sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins update sessions"
on public.hometogether_rule_sessions for update to authenticated
using (public.hometogether_is_admin())
with check (public.hometogether_is_admin());

drop policy if exists "hometogether admins delete sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins delete sessions"
on public.hometogether_rule_sessions for delete to authenticated
using (public.hometogether_is_admin());

create or replace function public.hometogether_touch_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state->>'status' = 'signed' and new.state is distinct from old.state then
    raise exception '서명 완료된 합의서는 수정할 수 없습니다.';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hometogether_touch_session on public.hometogether_rule_sessions;
create trigger hometogether_touch_session
before update on public.hometogether_rule_sessions
for each row execute function public.hometogether_touch_session();

create or replace function public.hometogether_get_session(p_token text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.hometogether_rule_sessions%rowtype;
begin
  if p_role not in ('host', 'guest') or p_token is null or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_session
  from public.hometogether_rule_sessions
  where token_expires_at > now()
    and ((p_role = 'host' and host_token::text = lower(p_token))
      or (p_role = 'guest' and guest_token::text = lower(p_token)));

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'state', v_session.state,
    'expires_at', v_session.token_expires_at
  );
end;
$$;

create or replace function public.hometogether_update_session(p_token text, p_role text, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.hometogether_rule_sessions%rowtype;
  v_old_status text;
  v_new_status text;
  v_household jsonb;
  v_items jsonb;
  v_agreements jsonb;
  v_signer text;
  v_next_state jsonb;
begin
  if p_role not in ('host', 'guest') or p_token is null or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception '유효하지 않은 참여자 링크입니다.';
  end if;
  if jsonb_typeof(p_state) <> 'object' or jsonb_typeof(p_state->'items') <> 'array' or octet_length(p_state::text) > 250000 then
    raise exception '올바르지 않은 합의서 데이터입니다.';
  end if;

  select * into v_session
  from public.hometogether_rule_sessions
  where token_expires_at > now()
    and ((p_role = 'host' and host_token::text = lower(p_token))
      or (p_role = 'guest' and guest_token::text = lower(p_token)))
  for update;

  if not found then raise exception '만료되었거나 유효하지 않은 참여자 링크입니다.'; end if;

  v_old_status := v_session.state->>'status';
  v_new_status := p_state->>'status';
  if v_old_status in ('signed', 'needs_manager') then
    raise exception '현재 상태에서는 합의서를 수정할 수 없습니다.';
  end if;

  if p_role = 'host' and not (
    (v_old_status = 'host_editing' and v_new_status in ('host_editing', 'guest_review')) or
    (v_old_status = 'host_revision' and v_new_status in ('host_revision', 'guest_final')) or
    (v_old_status in ('guest_review', 'guest_final') and v_new_status in (v_old_status, 'signed'))
  ) then raise exception '호스트가 변경할 수 없는 진행 상태입니다.'; end if;

  if p_role = 'guest' and not (
    (v_old_status = 'guest_review' and v_new_status in ('guest_review', 'host_revision', 'guest_final')) or
    (v_old_status = 'guest_final' and v_new_status in ('guest_final', 'needs_manager')) or
    (v_old_status = 'host_editing' and v_new_status = 'host_editing')
  ) then raise exception '학생이 변경할 수 없는 진행 상태입니다.'; end if;

  v_household := v_session.state->'household';
  if p_role = 'host' then
    v_household := v_household || jsonb_build_object(
      'hostName', left(coalesce(p_state->'household'->>'hostName', v_household->>'hostName'), 80),
      'address', left(coalesce(p_state->'household'->>'address', v_household->>'address'), 200)
    );
  else
    v_household := v_household || jsonb_build_object(
      'guestName', left(coalesce(p_state->'household'->>'guestName', v_household->>'guestName'), 80),
      'address', left(coalesce(p_state->'household'->>'address', v_household->>'address'), 200)
    );
  end if;

  select coalesce(jsonb_agg(
    case when p_role = 'host' then
      old_item || jsonb_build_object(
        'selected', case when new_item->>'selected' is not null then new_item->>'selected' else old_item->>'selected' end,
        'visible', case when new_item ? 'visible' then (new_item->>'visible')::boolean else (old_item->>'visible')::boolean end,
        'hostAction', case when v_old_status = 'host_revision' and new_item->>'hostAction' in ('accepted','kept') then new_item->>'hostAction' else old_item->>'hostAction' end
      )
    else
      old_item || jsonb_build_object(
        'guestStatus', case when new_item->>'guestStatus' in ('pending','confirmed','change_requested') then new_item->>'guestStatus' else old_item->>'guestStatus' end,
        'guestNote', case when new_item->>'guestStatus' = 'change_requested' then left(coalesce(new_item->>'guestNote',''), 1000) else null end
      )
    end order by ord
  ), '[]'::jsonb) into v_items
  from jsonb_array_elements(v_session.state->'items') with ordinality as old_rows(old_item, ord)
  left join lateral (
    select candidate as new_item
    from jsonb_array_elements(p_state->'items') candidate
    where candidate->>'key' = old_item->>'key'
    limit 1
  ) incoming on true;

  v_agreements := coalesce(v_session.state->'agreements', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = p_role)
     and exists (select 1 from jsonb_array_elements(coalesce(p_state->'agreements','[]'::jsonb)) a where a->>'party' = p_role) then
    select left(trim(a->>'signerName'), 80) into v_signer
    from jsonb_array_elements(p_state->'agreements') a where a->>'party' = p_role limit 1;
    if coalesce(char_length(v_signer), 0) < 2 then raise exception '서명자 성명을 확인해주세요.'; end if;
    v_agreements := v_agreements || jsonb_build_array(jsonb_build_object(
      'party', p_role, 'signerName', v_signer, 'agreedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
  end if;

  if v_new_status = 'signed' and (
    not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = 'host') or
    not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = 'guest')
  ) then raise exception '두 참여자의 서명이 모두 필요합니다.'; end if;

  v_next_state := v_session.state || jsonb_build_object(
    'household', v_household,
    'items', v_items,
    'agreements', v_agreements,
    'status', v_new_status,
    'updatedAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  update public.hometogether_rule_sessions set state = v_next_state where id = v_session.id;
  return jsonb_build_object('ok', true, 'state', v_next_state);
end;
$$;

revoke all on function public.hometogether_get_session(text, text) from public;
revoke all on function public.hometogether_update_session(text, text, jsonb) from public;
grant execute on function public.hometogether_get_session(text, text) to anon, authenticated;
grant execute on function public.hometogether_update_session(text, text, jsonb) to anon, authenticated;

grant select, insert, update, delete on public.hometogether_rule_sessions to authenticated;
revoke all on public.hometogether_rule_sessions from anon;
revoke all on public.hometogether_rule_admins from anon, authenticated;

;
