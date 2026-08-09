revoke execute on function public.hometogether_is_admin() from public, anon;
grant execute on function public.hometogether_is_admin() to authenticated;

revoke execute on function public.hometogether_touch_session() from public, anon, authenticated;

create index if not exists hometogether_rule_sessions_created_by_idx
on public.hometogether_rule_sessions(created_by);

comment on function public.hometogether_get_session(text, text) is
'Public RPC by design. Access requires a matching unguessable role token and an unexpired session.';

comment on function public.hometogether_update_session(text, text, jsonb) is
'Public RPC by design. Access requires a matching unguessable role token; role-specific state transitions are enforced server-side.';

;
