import "server-only";

import { randomUUID } from "node:crypto";

import {
  calculateInvitationExpiry,
  createOpaqueTokenForContext,
  hashToken,
} from "@/lib/checkin/token";
import {
  QUESTIONNAIRE_VERSION,
  type CheckinSubmission,
  type DashboardData,
  type DashboardResponseRow,
  type PublicInvitation,
  type RiskHistoryContext,
  type RiskLevel,
  type RiskResult,
  type StoredResponse,
  type SupportCaseSummary,
} from "@/lib/checkin/types";
import {
  evaluateWeeklyEligibility,
  type EligibilityMatch,
} from "@/lib/checkin/eligibility";
import type {
  CheckinRepository,
  DispatchCandidate,
  EnqueueSummary,
  MessageDeliveryClaimOptions,
  SubmitResult,
  SupportCaseActionInput,
} from "@/lib/checkin/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMessageQueueProvider } from "@/lib/messaging/config";
import {
  retryDelayMs,
  type MessagingResult,
  type ProviderFailureClass,
} from "@/lib/messaging/provider";
import { fetchAllSupabaseRows } from "@/lib/supabase/pagination";

// Supabase relationships are intentionally ungenerated in this standalone
// feature package; runtime rows are normalized immediately by mapping helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRow = Record<string, any>;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_CANDIDATE_BATCH_SIZE = 2_000;

function first(value: unknown): JsonRow | undefined {
  if (Array.isArray(value)) return value[0] as JsonRow | undefined;
  return value && typeof value === "object" ? (value as JsonRow) : undefined;
}

function getKoreanWeek(now: Date) {
  const kstOffset = 9 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + kstOffset);
  const daysSinceMonday = local.getUTCDay() === 0 ? 6 : local.getUTCDay() - 1;
  const startEquivalent = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday),
  );
  const endEquivalent = new Date(startEquivalent.getTime() + 6 * DAY_MS);
  const asDate = (date: Date) => date.toISOString().slice(0, 10);
  return { weekStart: asDate(startEquivalent), weekEnd: asDate(endEquivalent) };
}

function formatDateRange(start: string, end: string) {
  const format = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
  return `${format.format(new Date(`${start}T00:00:00+09:00`))} ~ ${format.format(
    new Date(`${end}T23:59:59+09:00`),
  )}`;
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function mapSupportCase(
  row: JsonRow | null | undefined,
  invitationIsTest = false,
): SupportCaseSummary | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    responseId: row.response_id,
    matchId: row.match_id,
    participantId: row.participant_id,
    priority: row.priority,
    status: row.status,
    assignedAdminId: row.assigned_admin_id ?? undefined,
    acknowledgementAt: row.acknowledgement_at ?? undefined,
    firstContactAt: row.first_contact_at ?? undefined,
    resolvedAt: row.resolved_at ?? undefined,
    resolutionCode: row.resolution_code ?? undefined,
    internalNote: row.internal_note ?? undefined,
    events: Array.isArray(row.events)
      ? row.events.map((event: JsonRow) => ({
          id: event.id,
          action: event.action,
          adminId: event.admin_id ?? undefined,
          createdAt: event.created_at,
        }))
      : undefined,
    createdAt: row.created_at,
    // Child flags are denormalized for safety, but invitations remain the
    // source of truth for the admin UI and production statistics.
    isTest: invitationIsTest,
  };
}

function isTestInvitation(row: JsonRow | null | undefined): boolean {
  return row?.is_test === true;
}

function mapResponse(row: JsonRow): StoredResponse {
  return {
    id: row.id,
    invitationId: row.invitation_id,
    matchId: row.match_id,
    participantId: row.participant_id,
    role: row.role,
    submission: row.answers_json as CheckinSubmission,
    riskLevel: row.risk_level,
    riskReasons: Array.isArray(row.risk_reasons) ? row.risk_reasons : [],
    pairedMismatch: row.paired_mismatch === true,
    submittedAt: row.submitted_at,
  };
}

function mapDashboardResponse(
  row: JsonRow,
  invitation: JsonRow | null | undefined,
  supportCase?: SupportCaseSummary,
): DashboardResponseRow {
  const response = mapResponse(row);
  const run = first(invitation?.run);
  return {
    ...response,
    recipientName: first(invitation?.participant)?.display_name ?? "응답자",
    period: run ? formatDateRange(run.week_start, run.week_end) : "이번 주",
    isTest: isTestInvitation(invitation),
    supportCase,
  };
}

export class SupabaseCheckinRepository implements CheckinRepository {
  private readonly supabase = createAdminClient();

  private async invitationRow(tokenHash: string): Promise<JsonRow | null> {
    const { data, error } = await this.supabase
      .from("weekly_checkin_invitations")
      .select(
        "*, participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name,phone), run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end), draft:weekly_checkin_drafts(answers_json)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) throw error;
    return data as JsonRow | null;
  }

  private publicInvitation(row: JsonRow): PublicInvitation {
    const participant = first(row.participant);
    const run = first(row.run);
    const draft = first(row.draft);
    return {
      id: row.id,
      recipientName: participant?.display_name ?? "응답자",
      role: row.role,
      period: run ? formatDateRange(run.week_start, run.week_end) : "이번 주",
      expiresAt: row.expires_at,
      status: row.status,
      completedAt: row.completed_at ?? undefined,
      draft: draft?.answers_json ?? undefined,
    };
  }

  async findInvitation(tokenHash: string, markOpened = true): Promise<PublicInvitation | null> {
    const row = await this.invitationRow(tokenHash);
    if (!row) return null;
    if (
      markOpened &&
      !row.completed_at &&
      new Date(row.expires_at).getTime() > Date.now() &&
      ["PENDING", "SENDING", "SENT", "FAILED"].includes(row.status)
    ) {
      const { error } = await this.supabase
        .from("weekly_checkin_invitations")
        .update({ status: "OPENED", opened_at: row.opened_at ?? new Date().toISOString() })
        .eq("id", row.id)
        .is("completed_at", null);
      if (error) throw error;
      row.status = "OPENED";
    }
    return this.publicInvitation(row);
  }

  async saveDraft(tokenHash: string, answers: Record<string, unknown>): Promise<PublicInvitation> {
    const row = await this.invitationRow(tokenHash);
    if (!row) throw new Error("INVITATION_NOT_FOUND");
    const { error } = await this.supabase.rpc("save_weekly_checkin_draft", {
      p_invitation_id: row.id,
      p_token_hash: tokenHash,
      p_questionnaire_version: QUESTIONNAIRE_VERSION,
      p_answers: answers,
    });
    if (error) {
      if (error.message.includes("expired")) throw new Error("INVITATION_EXPIRED");
      throw error;
    }
    return { ...this.publicInvitation(row), status: "OPENED", draft: answers };
  }

  async getRiskHistory(tokenHash: string): Promise<RiskHistoryContext> {
    const invitation = await this.invitationRow(tokenHash);
    if (!invitation) return {};

    const currentRun = first(invitation.run);
    if (!currentRun?.week_start) throw new Error("INVITATION_RUN_NOT_FOUND");
    const previousWeekStart = shiftIsoDate(currentRun.week_start, -7);

    const [previousRunResult, counterpartInvitationResult, signalsResult] = await Promise.all([
      this.supabase
        .from("weekly_checkin_runs")
        .select("id")
        .eq("week_start", previousWeekStart)
        .maybeSingle(),
      this.supabase
        .from("weekly_checkin_invitations")
        .select("id")
        .eq("run_id", invitation.run_id)
        .eq("match_id", invitation.match_id)
        .neq("participant_id", invitation.participant_id)
        .limit(1)
        .maybeSingle(),
      this.supabase
        .from("weekly_checkin_signals")
        .select("signal_type")
        .eq("run_id", invitation.run_id)
        .eq("participant_id", invitation.participant_id)
        .eq("signal_type", "TWO_CONSECUTIVE_NON_RESPONSES"),
    ]);
    const historyError =
      previousRunResult.error ?? counterpartInvitationResult.error ?? signalsResult.error;
    if (historyError) throw historyError;

    const counterpartInvitation = counterpartInvitationResult.data;
    const signals = signalsResult.data;

    let previous: JsonRow | null = null;
    if (previousRunResult.data?.id) {
      const { data: previousInvitation, error: previousInvitationError } = await this.supabase
        .from("weekly_checkin_invitations")
        .select("id")
        .eq("run_id", previousRunResult.data.id)
        .eq("match_id", invitation.match_id)
        .eq("participant_id", invitation.participant_id)
        .maybeSingle();
      if (previousInvitationError) throw previousInvitationError;

      if (previousInvitation?.id) {
        const { data: previousResponse, error: previousResponseError } = await this.supabase
          .from("weekly_checkin_responses")
          .select("id, weekly_checkin_issues(subcategory)")
          .eq("invitation_id", previousInvitation.id)
          .maybeSingle();
        if (previousResponseError) throw previousResponseError;
        previous = previousResponse as JsonRow | null;
      }
    }

    let counterpartRiskLevel: RiskLevel | undefined;
    if (counterpartInvitation?.id) {
      const { data: counterpart, error: counterpartError } = await this.supabase
        .from("weekly_checkin_responses")
        .select("risk_level")
        .eq("invitation_id", counterpartInvitation.id)
        .maybeSingle();
      if (counterpartError) throw counterpartError;
      counterpartRiskLevel = counterpart?.risk_level as RiskLevel | undefined;
    }

    const previousIssues = (previous as JsonRow | null)?.weekly_checkin_issues;
    return {
      repeatedSubcategories: Array.isArray(previousIssues)
        ? previousIssues.map((issue: JsonRow) => issue.subcategory)
        : [],
      consecutiveMissedWeeks: signals?.length ? 2 : 0,
      counterpartRiskLevel,
    };
  }

  async submit(
    tokenHash: string,
    submission: CheckinSubmission,
    risk: RiskResult,
  ): Promise<SubmitResult> {
    const invitation = await this.invitationRow(tokenHash);
    if (!invitation) throw new Error("INVITATION_NOT_FOUND");
    const { data, error } = await this.supabase.rpc("submit_weekly_checkin", {
      p_token_hash: tokenHash,
      p_submission: submission,
      p_risk_level: risk.riskLevel,
      p_risk_reasons: risk.riskReasons,
      p_paired_mismatch: risk.pairedMismatch,
    });
    if (error) {
      if (error.message.includes("expired")) throw new Error("INVITATION_EXPIRED");
      throw error;
    }
    const result = first(data) ?? (data as JsonRow);
    const responseId = result.response_id ?? result.responseId;
    const supportCaseId = result.support_case_id ?? result.supportCaseId;
    if (typeof responseId !== "string") {
      throw new Error("SUBMIT_RPC_INVALID_RESPONSE");
    }
    const { data: responseRow, error: responseError } = await this.supabase
      .from("weekly_checkin_responses")
      .select("*")
      .eq("id", responseId)
      .single();
    if (responseError) throw responseError;
    let supportCase: SupportCaseSummary | undefined;
    if (supportCaseId) {
      const { data: caseRow, error: caseError } = await this.supabase
        .from("support_cases")
        .select("*")
        .eq("id", supportCaseId)
        .single();
      if (caseError) throw caseError;
      supportCase = mapSupportCase(caseRow as JsonRow, isTestInvitation(invitation));
    }
    return {
      response: mapResponse(responseRow as JsonRow),
      supportCase,
      alreadyCompleted: Boolean(result.already_completed ?? result.alreadyCompleted),
    };
  }

  async claimMessageDeliveries(
    options: MessageDeliveryClaimOptions,
  ): Promise<DispatchCandidate[]> {
    const leaseOwner = `vercel-${randomUUID()}`;
    const { data, error } = await this.supabase.rpc("claim_message_deliveries", {
      p_provider: options.provider,
      p_lease_owner: leaseOwner,
      p_allow_production: options.allowProduction,
      p_allow_admin_test: options.allowAdminTest,
      p_limit: options.limit,
      p_lease_seconds: 120,
    });
    if (error) throw error;
    const claims = (data ?? []) as JsonRow[];
    if (!claims.length) return [];

    const invitationIds = claims
      .map((claim) => claim.invitation_id)
      .filter((value): value is string => typeof value === "string");
    const invitationRows = invitationIds.length
      ? await this.supabase
          .from("weekly_checkin_invitations")
          .select("id,run_id,match_id,participant_id,role,token_hash,status,expires_at")
          .in("id", invitationIds)
      : { data: [], error: null };
    if (invitationRows.error) throw invitationRows.error;
    const invitationMap = new Map(
      ((invitationRows.data ?? []) as JsonRow[]).map((row) => [row.id as string, row]),
    );

    const candidates: DispatchCandidate[] = [];
    for (const claim of claims) {
      if (claim.delivery_scope === "ADMIN_TEST") {
        const variables = (claim.template_variables ?? {}) as Record<string, unknown>;
        candidates.push({
          recipientId: claim.participant_id ?? "admin-test",
          recipientName:
            typeof variables.name === "string" ? variables.name : "홈투게더 관리자",
          phone: claim.phone,
          counterpartLabel:
            variables.counterpartLabel === "학생분" ||
            variables.counterpartLabel === "집주인분"
              ? variables.counterpartLabel
              : "공동생활 상대방",
          period: typeof variables.period === "string" ? variables.period : "알림톡 발송 테스트",
          deadline: typeof variables.deadline === "string" ? variables.deadline : "테스트 발송 후 확인",
          checkinUrl: typeof variables.checkinUrl === "string" ? variables.checkinUrl : undefined,
          idempotencyKey: claim.idempotency_key,
          messageLogId: claim.message_log_id,
          deliveryLeaseOwner: leaseOwner,
          messageType: "ALIMTALK_TEST",
          deliveryScope: "ADMIN_TEST",
          templateCode: claim.template_code ?? undefined,
          providerMessageId: claim.provider_message_id ?? undefined,
          failureClass: claim.failure_class ?? undefined,
          attemptCount: claim.attempt_count,
          maxAttempts: claim.max_attempts,
        });
        continue;
      }

      const invitation = invitationMap.get(claim.invitation_id);
      if (!invitation) continue;
      const context = `weekly:${claim.week_start}:${claim.participant_id}:${invitation.match_id}`;
      const rawToken = createOpaqueTokenForContext(context);
      if (hashToken(rawToken) !== claim.token_hash) {
        const { error: completionError } = await this.supabase.rpc("complete_message_delivery", {
          p_message_log_id: claim.message_log_id,
          p_lease_owner: leaseOwner,
          p_success: false,
          p_error_code: "TOKEN_RECONSTRUCTION_MISMATCH",
          p_error_message_sanitized: "Token cannot be reconstructed; rotate invitation token.",
          p_retryable: false,
          p_failure_class: "PERMANENT",
        });
        if (completionError) throw completionError;
        continue;
      }

      candidates.push({
        invitation: {
          id: invitation.id,
          runId: invitation.run_id,
          matchId: invitation.match_id,
          participantId: invitation.participant_id,
          role: invitation.role,
          tokenHash: invitation.token_hash,
          recipientName: claim.recipient_name,
          phone: claim.phone,
          period: formatDateRange(claim.week_start, claim.week_end),
          expiresAt: invitation.expires_at,
          status: invitation.status,
        },
        rawToken,
        recipientId: invitation.participant_id,
        recipientName: claim.recipient_name,
        phone: claim.phone,
        counterpartLabel: claim.participant_role === "HOST" ? "학생분" : "집주인분",
        period: formatDateRange(claim.week_start, claim.week_end),
        deadline: formatDeadline(claim.expires_at),
        idempotencyKey: claim.idempotency_key,
        messageLogId: claim.message_log_id,
        deliveryLeaseOwner: leaseOwner,
        messageType: claim.message_type,
        deliveryScope: "PRODUCTION",
        templateCode: claim.template_code ?? undefined,
        providerMessageId: claim.provider_message_id ?? undefined,
        failureClass: claim.failure_class ?? undefined,
        attemptCount: claim.attempt_count,
        maxAttempts: claim.max_attempts,
      });
    }
    return candidates;
  }

  async enqueueWeeklyMessages(now: Date): Promise<EnqueueSummary> {
    const provider = getMessageQueueProvider();
    const { weekStart, weekEnd } = getKoreanWeek(now);
    const expiresAt = calculateInvitationExpiry(now);
    const matches = await fetchAllSupabaseRows<JsonRow>((from, to) =>
      this.supabase
        .from("matches")
        .select(
          "id,host_id,guest_id,status,move_in_date,move_out_date,contract_end_date,home:homes!matches_home_id_fkey(is_active),host:profiles!matches_host_id_fkey(id,is_active,notification_enabled,phone),guest:profiles!matches_guest_id_fkey(id,is_active,notification_enabled,phone)",
        )
        .eq("status", "ACTIVE")
        .order("id")
        .range(from, to),
    );

    const eligibilityMatches: EligibilityMatch[] = matches.map((match) => {
      const home = first(match.home);
      const host = first(match.host);
      const guest = first(match.guest);
      return {
        id: match.id,
        status: match.status,
        moveInDate: match.move_in_date,
        moveOutDate: match.move_out_date ?? null,
        contractEndDate: match.contract_end_date ?? null,
        homeActive: home?.is_active === true,
        host: {
          id: match.host_id,
          active: host?.is_active === true,
          notificationEnabled: host?.notification_enabled === true,
          phone: typeof host?.phone === "string" ? host.phone : null,
        },
        guest: {
          id: match.guest_id,
          active: guest?.is_active === true,
          notificationEnabled: guest?.notification_enabled === true,
          phone: typeof guest?.phone === "string" ? guest.phone : null,
        },
      };
    });
    const eligibility = evaluateWeeklyEligibility({
      matches: eligibilityMatches,
      asOfDate: new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    });
    const dataQualityParticipantIds = new Set(
      eligibility.excluded
        .filter((item) => item.code === "MULTIPLE_ACTIVE_MATCHES")
        .map((item) => item.participantId),
    );
    const candidates: Array<{
      match_id: string;
      participant_id: string;
      role: "HOST" | "GUEST";
      token_hash: string;
    }> = [];
    for (const target of eligibility.eligible) {
      const rawToken = createOpaqueTokenForContext(
        `weekly:${weekStart}:${target.participantId}:${target.matchId}`,
      );
      candidates.push({
        match_id: target.matchId,
        participant_id: target.participantId,
        role: target.role,
        token_hash: hashToken(rawToken),
      });
    }

    const candidateBatches = candidates.length
      ? Array.from(
          { length: Math.ceil(candidates.length / WEEKLY_CANDIDATE_BATCH_SIZE) },
          (_, index) =>
            candidates.slice(
              index * WEEKLY_CANDIDATE_BATCH_SIZE,
              (index + 1) * WEEKLY_CANDIDATE_BATCH_SIZE,
            ),
        )
      : [[]];
    const batchRows: JsonRow[] = [];
    for (const candidateBatch of candidateBatches) {
      const { data, error: batchError } = await this.supabase.rpc(
        "create_weekly_checkin_batch",
        {
          p_week_start: weekStart,
          p_week_end: weekEnd,
          p_send_at: now.toISOString(),
          p_reminder_at: new Date(now.getTime() + DAY_MS).toISOString(),
          p_expires_at: expiresAt.toISOString(),
          p_candidates: candidateBatch,
          p_provider: provider,
        },
      );
      if (batchError) throw batchError;
      if (Array.isArray(data)) batchRows.push(...(data as JsonRow[]));
      else if (data) batchRows.push(data as JsonRow);
    }

    let runId = first(batchRows)?.run_id as string | undefined;
    if (!runId) {
      const { data: existingRun, error: runError } = await this.supabase
        .from("weekly_checkin_runs")
        .select("id")
        .eq("week_start", weekStart)
        .single();
      if (runError) throw runError;
      runId = existingRun.id;
    }

    const { error: signalError } = await this.supabase.rpc("refresh_nonresponse_signals", {
      p_run_id: runId,
    });
    if (signalError) throw signalError;

    return {
      queued: batchRows.length,
      dataQualityCount: dataQualityParticipantIds.size,
    };
  }

  async enqueueReminderMessages(now: Date): Promise<EnqueueSummary> {
    if (process.env.ENABLE_CHECKIN_REMINDERS === "false") {
      return { queued: 0, dataQualityCount: 0 };
    }
    const provider = getMessageQueueProvider();
    const runs = await fetchAllSupabaseRows<JsonRow>((from, to) =>
      this.supabase
        .from("weekly_checkin_runs")
        .select("id")
        .lte("reminder_at", now.toISOString())
        .gt("expires_at", now.toISOString())
        .order("id")
        .range(from, to),
    );
    let queued = 0;
    for (const run of runs) {
      const { data: count, error: enqueueError } = await this.supabase.rpc("enqueue_weekly_checkin_reminders", {
        p_run_id: run.id,
        p_provider: provider,
      });
      if (enqueueError) throw enqueueError;
      queued += typeof count === "number" ? count : 0;
    }
    return { queued, dataQualityCount: 0 };
  }

  async saveMessageTemplate(
    candidate: DispatchCandidate,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<void> {
    if (!candidate.messageLogId || !candidate.deliveryLeaseOwner) {
      throw new Error("Supabase delivery claim metadata is missing");
    }
    const safeVariables = Object.fromEntries(
      Object.entries(variables).filter(
        ([key]) => key !== "checkinUrl" && key !== "checkin_url",
      ),
    );
    const { error } = await this.supabase
      .from("message_logs")
      .update({ template_code: templateCode, template_variables: safeVariables })
      .eq("id", candidate.messageLogId)
      .eq("lease_owner", candidate.deliveryLeaseOwner)
      .eq("status", "SENDING");
    if (error) throw error;
  }

  async recordMessageResult(
    candidate: DispatchCandidate,
    _messageType: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER" | "ALIMTALK_TEST",
    _provider: string,
    result: MessagingResult,
  ): Promise<void> {
    if (!candidate.messageLogId || !candidate.deliveryLeaseOwner) {
      throw new Error("Supabase delivery claim metadata is missing");
    }
    const failureClass: ProviderFailureClass | undefined = result.success
      ? undefined
      : result.failureClass ?? "PERMANENT";
    const retryable = !result.success && failureClass !== "PERMANENT";
    const delay = retryDelayMs(candidate.attemptCount ?? 1, result.retryAfterSeconds);
    const { error } = await this.supabase.rpc("complete_message_delivery", {
      p_message_log_id: candidate.messageLogId,
      p_lease_owner: candidate.deliveryLeaseOwner,
      p_success: result.success,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error_code: result.errorCode ?? null,
      p_error_message_sanitized: result.errorMessage?.slice(0, 500) ?? null,
      p_retryable: retryable,
      p_next_attempt_at: retryable ? new Date(Date.now() + delay).toISOString() : null,
      p_failure_class: failureClass ?? null,
    });
    if (error) throw error;
  }

  async getDashboard(): Promise<DashboardData> {
    const [invitations, responseRows, caseRows, caseEventRows, messages, runsResult, signals] =
      await Promise.all([
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("weekly_checkin_invitations")
            .select(
              "*, participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name), run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end)",
            )
            .order("id")
            .range(from, to),
        ),
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("weekly_checkin_responses")
            .select("*")
            .order("id")
            .range(from, to),
        ),
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("support_cases")
            .select("*")
            .order("id")
            .range(from, to),
        ),
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("support_case_events")
            .select("id,support_case_id,action,admin_id,created_at")
            .order("id")
            .range(from, to),
        ),
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("message_logs")
            .select("invitation_id,status,message_type,is_test")
            .order("id")
            .range(from, to),
        ),
        this.supabase
          .from("weekly_checkin_runs")
          .select("id,week_start,week_end")
          .order("week_start", { ascending: false })
          .limit(1),
        fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("weekly_checkin_signals")
            .select("run_id,invitation_id,signal_type,is_test")
            .order("id")
            .range(from, to),
        ),
      ]);
    if (runsResult.error) throw runsResult.error;

    const invitationMap = new Map(invitations.map((row) => [row.id, row]));
    const responseInvitationMap = new Map(
      responseRows.map((row) => [row.id as string, invitationMap.get(row.invitation_id)]),
    );
    const eventsByCase = new Map<string, JsonRow[]>();
    for (const event of caseEventRows) {
      const events = eventsByCase.get(event.support_case_id) ?? [];
      events.push(event);
      eventsByCase.set(event.support_case_id, events);
    }
    const supportCases = caseRows
      .map((row) =>
        mapSupportCase(
          { ...row, events: eventsByCase.get(row.id) ?? [] },
          isTestInvitation(responseInvitationMap.get(row.response_id)),
        ),
      )
      .filter((item): item is SupportCaseSummary => item !== undefined);
    const caseMap = new Map(supportCases.map((supportCase) => [supportCase.responseId, supportCase]));
    const riskCounts: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
    const categoryCounts: Record<string, number> = {};
    const responses: DashboardResponseRow[] = responseRows.map((row) => {
      const invitation = invitationMap.get(row.invitation_id);
      return mapDashboardResponse(row, invitation, caseMap.get(row.id));
    });
    responses.sort((a, b) => {
      const urgentA = a.riskLevel === "RED" && a.supportCase?.status === "UNACKNOWLEDGED" ? 1 : 0;
      const urgentB = b.riskLevel === "RED" && b.supportCase?.status === "UNACKNOWLEDGED" ? 1 : 0;
      return urgentB - urgentA || b.submittedAt.localeCompare(a.submittedAt);
    });

    const latestRun = first(runsResult.data);
    const currentInvitations = (latestRun
      ? invitations.filter((row) => row.run_id === latestRun.id)
      : invitations
    ).filter((row) => !isTestInvitation(row));
    const currentInvitationIds = new Set(currentInvitations.map((row) => row.id));
    const responseIsTest = new Map(responseRows.map((row) => [row.id as string, row.is_test === true]));
    const currentResponses = responses.filter(
      (row) => currentInvitationIds.has(row.invitationId) && responseIsTest.get(row.id) !== true,
    );
    const currentResponseIds = new Set(currentResponses.map((row) => row.id));
    for (const response of currentResponses) {
      riskCounts[response.riskLevel] += 1;
      for (const issue of response.submission.issues ?? []) {
        categoryCounts[issue.category] = (categoryCounts[issue.category] ?? 0) + 1;
      }
    }
    const caseIsTest = new Map(caseRows.map((row) => [row.id as string, row.is_test === true]));
    const currentCases = supportCases.filter(
      (item) => currentResponseIds.has(item.responseId) && caseIsTest.get(item.id) !== true,
    );
    const hostTargets = currentInvitations.filter((row) => row.role === "HOST");
    const guestTargets = currentInvitations.filter((row) => row.role === "GUEST");
    const currentSignals = signals.filter(
      (row) =>
        (!latestRun || row.run_id === latestRun.id) &&
        row.is_test !== true &&
        (!row.invitation_id || !isTestInvitation(invitationMap.get(row.invitation_id))),
    );
    const currentMessages = messages.filter((row) =>
      currentInvitationIds.has(row.invitation_id) && row.is_test !== true,
    );
    return {
      period: latestRun ? formatDateRange(latestRun.week_start, latestRun.week_end) : "이번 주",
      stats: {
        targetCount: currentInvitations.length,
        sentCount: currentInvitations.filter((row) => ["SENT", "OPENED", "COMPLETED"].includes(row.status))
          .length,
        failedCount: currentMessages.filter((row) => row.status === "FAILED").length,
        completedCount: currentResponses.length,
        hostResponseRate: hostTargets.length
          ? Math.round((currentResponses.filter((row) => row.role === "HOST").length / hostTargets.length) * 100)
          : 0,
        guestResponseRate: guestTargets.length
          ? Math.round((currentResponses.filter((row) => row.role === "GUEST").length / guestTargets.length) * 100)
          : 0,
        riskCounts,
        unacknowledgedCritical: currentCases.filter(
          (item) => item.priority === "RED" && item.status === "UNACKNOWLEDGED",
        ).length,
        categoryCounts,
        repeatedIssueCount: currentSignals.filter((row) => row.signal_type === "REPEATED_SUBCATEGORY").length,
        consecutiveNonResponseCount: currentSignals.filter(
          (row) => row.signal_type === "TWO_CONSECUTIVE_NON_RESPONSES",
        ).length,
        pairedMismatchCount: currentResponses.filter((row) => row.pairedMismatch).length,
      },
      responses,
      supportCases: supportCases.sort((a, b) => {
        const urgentA = a.priority === "RED" && a.status === "UNACKNOWLEDGED" ? 1 : 0;
        const urgentB = b.priority === "RED" && b.status === "UNACKNOWLEDGED" ? 1 : 0;
        return urgentB - urgentA || b.createdAt.localeCompare(a.createdAt);
      }),
    };
  }

  async getResponse(responseId: string): Promise<DashboardResponseRow | null> {
    const { data: response, error: responseError } = await this.supabase
      .from("weekly_checkin_responses")
      .select("*")
      .eq("id", responseId)
      .maybeSingle();
    if (responseError) throw responseError;
    if (!response) return null;

    const [invitationResult, supportCaseResult] = await Promise.all([
      this.supabase
        .from("weekly_checkin_invitations")
        .select(
          "*, participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name), run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end)",
        )
        .eq("id", response.invitation_id)
        .maybeSingle(),
      this.supabase
        .from("support_cases")
        .select("*")
        .eq("response_id", response.id)
        .maybeSingle(),
    ]);
    const detailError = invitationResult.error ?? supportCaseResult.error;
    if (detailError) throw detailError;

    const invitation = invitationResult.data as JsonRow | null;
    const supportCaseRow = supportCaseResult.data as JsonRow | null;
    const supportCaseEvents = supportCaseRow
      ? await fetchAllSupabaseRows<JsonRow>((from, to) =>
          this.supabase
            .from("support_case_events")
            .select("id,support_case_id,action,admin_id,created_at")
            .eq("support_case_id", supportCaseRow.id)
            .order("id")
            .range(from, to),
        )
      : [];
    const supportCase = mapSupportCase(
      supportCaseRow ? { ...supportCaseRow, events: supportCaseEvents } : null,
      isTestInvitation(invitation),
    );
    return mapDashboardResponse(response as JsonRow, invitation, supportCase);
  }

  async getSupportCase(caseId: string): Promise<SupportCaseSummary | null> {
    const { data: supportCase, error: supportCaseError } = await this.supabase
      .from("support_cases")
      .select("*")
      .eq("id", caseId)
      .maybeSingle();
    if (supportCaseError) throw supportCaseError;
    if (!supportCase) return null;

    const [responseResult, supportCaseEvents] = await Promise.all([
      this.supabase
        .from("weekly_checkin_responses")
        .select("invitation_id")
        .eq("id", supportCase.response_id)
        .maybeSingle(),
      fetchAllSupabaseRows<JsonRow>((from, to) =>
        this.supabase
          .from("support_case_events")
          .select("id,support_case_id,action,admin_id,created_at")
          .eq("support_case_id", supportCase.id)
          .order("id")
          .range(from, to),
      ),
    ]);
    if (responseResult.error) throw responseResult.error;
    const response = responseResult.data;

    let invitationIsTest = false;
    if (response?.invitation_id) {
      const { data: invitation, error: invitationError } = await this.supabase
        .from("weekly_checkin_invitations")
        .select("is_test")
        .eq("id", response.invitation_id)
        .maybeSingle();
      if (invitationError) throw invitationError;
      invitationIsTest = invitation?.is_test === true;
    }

    return mapSupportCase(
      { ...(supportCase as JsonRow), events: supportCaseEvents },
      invitationIsTest,
    ) ?? null;
  }

  async updateSupportCase(
    caseId: string,
    adminId: string,
    input: SupportCaseActionInput,
  ): Promise<SupportCaseSummary | null> {
    const { error } = await this.supabase.rpc("admin_update_support_case", {
      p_case_id: caseId,
      p_admin_id: adminId,
      p_action: input.action,
      p_assigned_admin_id: input.assignedAdminId ?? null,
      p_resolution_code: input.resolutionCode ?? null,
      p_internal_note: input.internalNote ?? null,
    });
    if (error) throw error;
    return this.getSupportCase(caseId);
  }

  async listDevelopmentLinks() {
    if (process.env.NODE_ENV === "production") return [];
    const { data, error } = await this.supabase
      .from("weekly_checkin_invitations")
      .select(
        "participant_id,match_id,role,token_hash,run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start),participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as JsonRow[]).flatMap((row) => {
      const run = first(row.run);
      const participant = first(row.participant);
      if (!run) return [];
      const urlToken = createOpaqueTokenForContext(
        `weekly:${run.week_start}:${row.participant_id}:${row.match_id}`,
      );
      if (hashToken(urlToken) !== row.token_hash) return [];
      return [{ label: `${participant?.display_name ?? "응답자"} · ${run.week_start}`, urlToken, role: row.role }];
    });
  }
}
