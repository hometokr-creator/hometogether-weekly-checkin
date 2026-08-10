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
  v_items jsonb;
  v_agreements jsonb;
  v_expected_signer text;
  v_custom_rule text;
  v_kitchen_selected text;
  v_next_state jsonb;
begin
  if p_role not in ('host', 'guest') or p_token is null
     or p_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception '유효하지 않은 참여자 링크입니다.';
  end if;
  if jsonb_typeof(p_state) <> 'object'
     or jsonb_typeof(p_state->'items') <> 'array'
     or jsonb_typeof(p_state->'agreements') <> 'array'
     or octet_length(p_state::text) > 250000 then
    raise exception '올바르지 않은 합의서 데이터입니다.';
  end if;

  select * into v_session
  from public.hometogether_rule_sessions
  where token_expires_at > now()
    and ((p_role = 'host' and host_token::text = lower(p_token))
      or (p_role = 'guest' and guest_token::text = lower(p_token)))
  for update;

  if not found then
    raise exception '만료되었거나 유효하지 않은 참여자 링크입니다.';
  end if;

  v_old_status := v_session.state->>'status';
  v_new_status := p_state->>'status';
  if v_old_status in ('signed', 'needs_manager') then
    raise exception '현재 상태에서는 합의서를 수정할 수 없습니다.';
  end if;
  if v_new_status not in ('host_editing','guest_review','host_revision','guest_final','signed','needs_manager') then
    raise exception '올바르지 않은 진행 상태입니다.';
  end if;

  if p_role = 'host' and not (
    (v_old_status = 'host_editing' and v_new_status in ('host_editing', 'guest_review')) or
    (v_old_status = 'host_revision' and v_new_status in ('host_revision', 'guest_final')) or
    (v_old_status = 'guest_review' and v_new_status = 'guest_review') or
    (v_old_status = 'guest_final' and v_new_status in ('guest_final', 'signed'))
  ) then
    raise exception '호스트가 변경할 수 없는 진행 상태입니다.';
  end if;

  if p_role = 'guest' and not (
    (v_old_status = 'guest_review' and v_new_status in ('guest_review', 'host_revision', 'guest_final')) or
    (v_old_status = 'guest_final' and v_new_status in ('guest_final', 'needs_manager'))
  ) then
    raise exception '학생이 변경할 수 없는 진행 상태입니다.';
  end if;

  -- 참가자는 관리자 등록 이름·주소·가구 정보를 바꿀 수 없다.
  if p_state->'household' is distinct from v_session.state->'household' then
    raise exception '가구 정보는 관리자만 변경할 수 있습니다.';
  end if;

  if p_role = 'host' and v_old_status = 'host_editing' then
    select candidate->>'detail' into v_custom_rule
    from jsonb_array_elements(p_state->'items') candidate
    where candidate->>'key' = 'prohibited'
    limit 1;

    if char_length(coalesce(v_custom_rule, '')) > 240
       or (select count(*) from regexp_split_to_table(coalesce(v_custom_rule, ''), E'\\r?\\n') line where btrim(line) <> '') > 3 then
      raise exception '우리 집 금지사항은 최대 3개, 240자까지 입력할 수 있습니다.';
    end if;
    if lower(coalesce(v_custom_rule, '')) ~ '(통금|종교|교회|예배|성당|법회|벌금|위약금|몰수|방에 들어|방 출입|무단|휴대폰|위치|cctv|검사)' then
      raise exception '이 내용은 금지사항으로 넣을 수 없습니다. 담당 매니저와 상의해주세요.';
    end if;
  end if;

  if p_role = 'guest' and v_old_status = 'guest_review'
     and exists (
       select 1 from jsonb_array_elements(p_state->'items') candidate
       where candidate->>'guestStatus' = 'change_requested'
         and char_length(btrim(coalesce(candidate->>'guestNote', ''))) < 3
     ) then
    raise exception '수정 요청 내용을 3자 이상 입력해주세요.';
  end if;

  select case when exists (
    select 1 from jsonb_array_elements(old_item->'options') option
    where option->>'key' = new_item->>'selected'
  ) then new_item->>'selected' else old_item->>'selected' end
  into v_kitchen_selected
  from jsonb_array_elements(v_session.state->'items') old_item
  left join lateral (
    select candidate as new_item
    from jsonb_array_elements(p_state->'items') candidate
    where candidate->>'key' = 'kitchen'
    limit 1
  ) incoming on true
  where old_item->>'key' = 'kitchen'
  limit 1;

  select coalesce(jsonb_agg(
    case
      when p_role = 'host' and v_old_status = 'host_editing' then
        (case when old_item->>'key' in ('prohibited','bathroom','kitchen','fridge','trash','laundry')
          then old_item - 'detail' else old_item end)
        || jsonb_strip_nulls(jsonb_build_object(
          'selected', chosen_option,
          'visible', case when old_item->>'key' = 'dishes' then v_kitchen_selected <> 'C' else (old_item->>'visible')::boolean end,
          'detail', case when old_item->>'key' in ('prohibited','bathroom','kitchen','fridge','trash','laundry')
            then nullif(left(btrim(coalesce(new_item->>'detail', '')), 500), '')
            else old_item->>'detail' end,
          'fixed', case when old_item->>'key' = 'bathroom' then
            case when chosen_option in ('A','B') then '각자 쓰는 화장실은 각자 청소해요.'
              else '사용 후에는 머리카락과 물기를 간단히 정리해요. 개인 용품(수건, 샤워용품 등)은 각자 준비하고, 지정된 자리에 보관해요.' end
            else old_item->>'fixed' end
        ))
      when p_role = 'host' and v_old_status = 'host_revision'
           and old_item->>'guestStatus' = 'change_requested' then
        old_item || jsonb_strip_nulls(jsonb_build_object(
          'selected', chosen_option,
          'visible', case when old_item->>'key' = 'dishes' then v_kitchen_selected <> 'C' else (old_item->>'visible')::boolean end,
          'hostAction', case when new_item->>'hostAction' in ('accepted','kept') then new_item->>'hostAction' else old_item->>'hostAction' end,
          'fixed', case when old_item->>'key' = 'bathroom' then
            case when chosen_option in ('A','B') then '각자 쓰는 화장실은 각자 청소해요.'
              else '사용 후에는 머리카락과 물기를 간단히 정리해요. 개인 용품(수건, 샤워용품 등)은 각자 준비하고, 지정된 자리에 보관해요.' end
            else old_item->>'fixed' end
        ))
      when p_role = 'host' and v_old_status = 'host_revision'
           and old_item->>'key' = 'dishes' then
        old_item || jsonb_build_object('visible', v_kitchen_selected <> 'C')
      when p_role = 'guest' and v_old_status = 'guest_review' then
        (old_item - 'guestNote') || jsonb_strip_nulls(jsonb_build_object(
          'guestStatus', case when new_item->>'guestStatus' in ('pending','confirmed','change_requested')
            then new_item->>'guestStatus' else old_item->>'guestStatus' end,
          'guestNote', case when new_item->>'guestStatus' = 'change_requested'
            then left(btrim(coalesce(new_item->>'guestNote','')), 1000) else null end
        ))
      when p_role = 'guest' and v_old_status = 'guest_final'
           and old_item ? 'guestNote'
           and old_item->>'guestStatus' in ('pending','change_requested')
           and new_item->>'guestStatus' = 'confirmed' then
        old_item || jsonb_build_object('guestStatus', 'confirmed')
      else old_item
    end order by ord
  ), '[]'::jsonb) into v_items
  from jsonb_array_elements(v_session.state->'items') with ordinality as old_rows(old_item, ord)
  left join lateral (
    select candidate as new_item
    from jsonb_array_elements(p_state->'items') candidate
    where candidate->>'key' = old_item->>'key'
    limit 1
  ) incoming on true
  left join lateral (
    select case
      when exists (
        select 1 from jsonb_array_elements(old_item->'options') option
        where option->>'key' = new_item->>'selected'
          and not (
            option->>'condition' = 'multiBathroom'
            and coalesce((v_session.state->'household'->>'bathroomCount')::int, 1) < 2
          )
      ) then new_item->>'selected'
      else old_item->>'selected'
    end as chosen_option
  ) validated on true;

  if p_role = 'host' and v_old_status = 'host_revision' and v_new_status = 'guest_final'
     and exists (
       select 1 from jsonb_array_elements(v_items) item
       where item->>'guestStatus' = 'change_requested'
         and coalesce(item->>'hostAction', '') not in ('accepted','kept')
     ) then
    raise exception '모든 수정 요청에 답해주세요.';
  end if;
  if p_role = 'guest' and v_old_status = 'guest_review' and v_new_status = 'host_revision'
     and not exists (
       select 1 from jsonb_array_elements(v_items) item
       where item->>'guestStatus' = 'change_requested'
     ) then
    raise exception '수정 요청이 없습니다.';
  end if;

  v_agreements := coalesce(v_session.state->'agreements', '[]'::jsonb);
  v_expected_signer := case when p_role = 'host'
    then v_session.state->'household'->>'hostName'
    else v_session.state->'household'->>'guestName' end;

  if not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = p_role)
     and exists (select 1 from jsonb_array_elements(p_state->'agreements') a where a->>'party' = p_role) then
    if p_role = 'guest' and v_old_status = 'guest_review'
       and exists (
         select 1 from jsonb_array_elements(v_items) item
         where coalesce((item->>'visible')::boolean, true)
           and item->>'guestStatus' <> 'confirmed'
       ) then
      raise exception '모든 생활규칙을 확인한 뒤 서명해주세요.';
    end if;
    if p_role = 'guest' and v_old_status = 'guest_final'
       and exists (
         select 1 from jsonb_array_elements(v_items) item
         where item ? 'guestNote' and item->>'guestStatus' <> 'confirmed'
       ) then
      raise exception '조율된 내용을 모두 확인한 뒤 서명해주세요.';
    end if;
    if p_role = 'host' and v_old_status <> 'guest_final' then
      raise exception '학생의 서명이 끝난 뒤 호스트가 서명할 수 있습니다.';
    end if;
    v_agreements := v_agreements || jsonb_build_array(jsonb_build_object(
      'party', p_role,
      'signerName', v_expected_signer,
      'agreedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
  end if;

  if p_role = 'guest' and v_old_status = 'guest_review' and v_new_status = 'guest_final'
     and not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = 'guest') then
    raise exception '학생 서명이 필요합니다.';
  end if;
  if v_new_status = 'signed' and (
    not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = 'host') or
    not exists (select 1 from jsonb_array_elements(v_agreements) a where a->>'party' = 'guest')
  ) then
    raise exception '두 참여자의 서명이 모두 필요합니다.';
  end if;

  v_next_state := v_session.state || jsonb_build_object(
    'items', v_items,
    'agreements', v_agreements,
    'status', v_new_status,
    'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  update public.hometogether_rule_sessions
  set state = v_next_state
  where id = v_session.id;

  return jsonb_build_object('ok', true, 'state', v_next_state);
end;
$$;

revoke all on function public.hometogether_update_session(text, text, jsonb) from public;
grant execute on function public.hometogether_update_session(text, text, jsonb) to anon, authenticated;

drop policy if exists "hometogether admins create sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins create sessions"
on public.hometogether_rule_sessions for insert to authenticated
with check ((select public.hometogether_is_admin()) and created_by = (select auth.uid()));

drop policy if exists "hometogether admins read sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins read sessions"
on public.hometogether_rule_sessions for select to authenticated
using ((select public.hometogether_is_admin()));

drop policy if exists "hometogether admins update sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins update sessions"
on public.hometogether_rule_sessions for update to authenticated
using ((select public.hometogether_is_admin()))
with check ((select public.hometogether_is_admin()));

drop policy if exists "hometogether admins delete sessions" on public.hometogether_rule_sessions;
create policy "hometogether admins delete sessions"
on public.hometogether_rule_sessions for delete to authenticated
using ((select public.hometogether_is_admin()));

comment on function public.hometogether_update_session(text, text, jsonb) is
'Public token RPC by design. It preserves admin-owned identity fields, validates role-specific transitions, restricts editable fields by phase, and fixes signer identity to the registered participant.';

;
