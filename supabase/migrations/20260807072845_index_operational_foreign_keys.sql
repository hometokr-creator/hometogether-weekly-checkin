-- Cover foreign keys used by administrator, import, eligibility, and outbox
-- paths. These indexes are additive and do not alter or rewrite customer rows.
create index if not exists admin_bootstrap_state_bootstrapped_by_idx
  on public.admin_bootstrap_state(bootstrapped_by);
create index if not exists admin_memberships_granted_by_idx
  on public.admin_memberships(granted_by);
create index if not exists admin_memberships_deactivated_by_idx
  on public.admin_memberships(deactivated_by);
create index if not exists audit_logs_admin_id_idx
  on public.audit_logs(admin_id);

create index if not exists data_import_batches_created_by_idx
  on public.data_import_batches(created_by);
create index if not exists data_import_rows_host_profile_id_idx
  on public.data_import_rows(host_profile_id);
create index if not exists data_import_rows_guest_profile_id_idx
  on public.data_import_rows(guest_profile_id);
create index if not exists data_import_rows_home_id_idx
  on public.data_import_rows(home_id);
create index if not exists data_import_rows_match_id_idx
  on public.data_import_rows(match_id);

create index if not exists matches_home_id_idx
  on public.matches(home_id);
create index if not exists message_logs_invitation_id_idx
  on public.message_logs(invitation_id);
create index if not exists message_logs_recipient_profile_id_idx
  on public.message_logs(recipient_profile_id);
create index if not exists support_case_events_admin_id_idx
  on public.support_case_events(admin_id);
create index if not exists support_cases_match_id_idx
  on public.support_cases(match_id);
create index if not exists support_cases_participant_id_idx
  on public.support_cases(participant_id);
create index if not exists weekly_checkin_invitations_participant_id_idx
  on public.weekly_checkin_invitations(participant_id);
create index if not exists weekly_checkin_responses_participant_id_idx
  on public.weekly_checkin_responses(participant_id);
create index if not exists weekly_checkin_signals_invitation_id_idx
  on public.weekly_checkin_signals(invitation_id);
create index if not exists weekly_checkin_signals_match_id_idx
  on public.weekly_checkin_signals(match_id);
