create or replace function public.hometogether_update_session_guarded(
  p_token text,
  p_role text,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.hometogether_rule_sessions%rowtype;
begin
  if p_role not in ('host', 'guest') or p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception '유효하지 않은 참여자 링크입니다.';
  end if;

  select * into v_session
  from public.hometogether_rule_sessions
  where token_expires_at > now()
    and ((p_role = 'host' and host_token::text = lower(p_token))
      or (p_role = 'guest' and guest_token::text = lower(p_token)));

  if not found then
    raise exception '만료되었거나 유효하지 않은 참여자 링크입니다.';
  end if;

  if p_role = 'host'
     and v_session.state->>'status' = 'host_editing'
     and v_session.state->'household'->>'workflowMode' = 'admin_preset' then
    raise exception '이 가구의 최초 규칙은 관리자가 확정합니다.';
  end if;

  return public.hometogether_update_session(p_token, p_role, p_state);
end;
$$;

revoke all on function public.hometogether_update_session(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hometogether_update_session_guarded(text, text, jsonb) from public;
grant execute on function public.hometogether_update_session_guarded(text, text, jsonb) to anon, authenticated;

comment on function public.hometogether_update_session_guarded(text, text, jsonb) is
'Public token RPC. Blocks host-side initial rule edits for admin-preset households, then delegates to the phase- and role-validated participant update function.';;
