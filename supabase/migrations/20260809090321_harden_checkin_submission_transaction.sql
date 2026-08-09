begin;

-- Serialize both participants for one match/run before looking for a paired
-- response. The previous application-side read could let simultaneous
-- submissions both observe "no counterpart" and permanently miss a mismatch.
-- This wrapper keeps the existing inner submit function and its idempotency,
-- while making paired reconciliation part of the same database transaction.
create or replace function public.submit_weekly_checkin(
  p_token_hash text,
  p_submission jsonb,
  p_risk_level text,
  p_risk_reasons jsonb,
  p_paired_mismatch boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invitation_id uuid;
  v_run_id uuid;
  v_match_id uuid;
  v_completed_at timestamptz;
  v_counterpart_risk_level text;
  v_effective_risk_level text := p_risk_level;
  v_effective_risk_reasons jsonb := p_risk_reasons;
  v_paired_mismatch boolean := coalesce(p_paired_mismatch, false);
  v_result record;
begin
  select
    invitation.id,
    invitation.run_id,
    invitation.match_id
  into
    v_invitation_id,
    v_run_id,
    v_match_id
  from public.weekly_checkin_invitations invitation
  where invitation.token_hash = lower(p_token_hash);

  if v_invitation_id is null then
    raise exception 'checkin_invitation_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'weekly-checkin-submit:' || v_run_id::text || ':' || v_match_id::text,
      0
    )
  );

  -- Re-read after acquiring the match/run lock. A retry of an already
  -- completed invitation must return the original result without allowing a
  -- different request body to alter paired state.
  select invitation.completed_at
  into v_completed_at
  from public.weekly_checkin_invitations invitation
  where invitation.id = v_invitation_id;

  if v_completed_at is not null then
    select * into v_result
    from public.submit_weekly_checkin(
      v_invitation_id,
      lower(p_token_hash),
      p_submission,
      p_risk_level,
      p_risk_reasons,
      p_paired_mismatch
    );

    return jsonb_build_object(
      'responseId', v_result.response_id,
      'supportCaseId', v_result.support_case_id,
      'alreadyCompleted', v_result.already_completed
    );
  end if;

  select response.risk_level
  into v_counterpart_risk_level
  from public.weekly_checkin_responses response
  join public.weekly_checkin_invitations counterpart_invitation
    on counterpart_invitation.id = response.invitation_id
  where counterpart_invitation.run_id = v_run_id
    and response.match_id = v_match_id
    and response.participant_id <> (
      select invitation.participant_id
      from public.weekly_checkin_invitations invitation
      where invitation.id = v_invitation_id
    )
  order by response.submitted_at desc
  limit 1;

  v_paired_mismatch := v_paired_mismatch or coalesce(
    (
      (p_risk_level = 'GREEN' and v_counterpart_risk_level in ('ORANGE', 'RED'))
      or
      (v_counterpart_risk_level = 'GREEN' and p_risk_level in ('ORANGE', 'RED'))
    ),
    false
  );

  if v_paired_mismatch then
    if v_effective_risk_level = 'GREEN' then
      v_effective_risk_level := 'YELLOW';
    end if;
    if jsonb_typeof(v_effective_risk_reasons) = 'array'
       and not (v_effective_risk_reasons @> '["PAIRED_RISK_MISMATCH"]'::jsonb) then
      v_effective_risk_reasons :=
        v_effective_risk_reasons || '["PAIRED_RISK_MISMATCH"]'::jsonb;
    end if;
  end if;

  select * into v_result
  from public.submit_weekly_checkin(
    v_invitation_id,
    lower(p_token_hash),
    p_submission,
    v_effective_risk_level,
    v_effective_risk_reasons,
    v_paired_mismatch
  );

  if v_paired_mismatch and not v_result.already_completed then
    update public.weekly_checkin_responses response
    set
      paired_mismatch = true,
      risk_level = case
        when response.risk_level = 'GREEN' then 'YELLOW'
        else response.risk_level
      end,
      risk_reasons = case
        when response.risk_reasons @> '["PAIRED_RISK_MISMATCH"]'::jsonb
          then response.risk_reasons
        else response.risk_reasons || '["PAIRED_RISK_MISMATCH"]'::jsonb
      end
    where response.match_id = v_match_id
      and exists (
        select 1
        from public.weekly_checkin_invitations paired_invitation
        where paired_invitation.id = response.invitation_id
          and paired_invitation.run_id = v_run_id
      );

    insert into public.weekly_checkin_signals (
      run_id,
      match_id,
      participant_id,
      invitation_id,
      signal_type,
      risk_level,
      reasons
    )
    select
      v_run_id,
      response.match_id,
      response.participant_id,
      response.invitation_id,
      'PAIRED_MISMATCH',
      response.risk_level,
      '["PAIRED_RISK_MISMATCH"]'::jsonb
    from public.weekly_checkin_responses response
    join public.weekly_checkin_invitations paired_invitation
      on paired_invitation.id = response.invitation_id
    where response.match_id = v_match_id
      and paired_invitation.run_id = v_run_id
    on conflict (run_id, participant_id, signal_type) do nothing;

    -- If the first response was GREEN, the second transaction promotes it to
    -- YELLOW. Emit the same deduplicated risk event used by ordinary risky
    -- submissions so integrations observe the retrospective classification.
    insert into public.integration_outbox (
      event_type,
      aggregate_type,
      aggregate_id,
      payload,
      dedupe_key,
      destination
    )
    select
      'weekly_checkin.risk_detected',
      'RESPONSE',
      response.id,
      jsonb_build_object(
        'responseId', response.id,
        'matchId', response.match_id,
        'participantId', response.participant_id,
        'role', response.role,
        'riskLevel', response.risk_level
      ),
      'weekly_checkin.risk_detected:' || response.id::text,
      'CRM'
    from public.weekly_checkin_responses response
    join public.weekly_checkin_invitations paired_invitation
      on paired_invitation.id = response.invitation_id
    where response.match_id = v_match_id
      and paired_invitation.run_id = v_run_id
      and response.risk_level <> 'GREEN'
    on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'responseId', v_result.response_id,
    'supportCaseId', v_result.support_case_id,
    'alreadyCompleted', v_result.already_completed
  );
end;
$$;

revoke all on function public.submit_weekly_checkin(text, jsonb, text, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_weekly_checkin(text, jsonb, text, jsonb, boolean)
  to service_role;

commit;
