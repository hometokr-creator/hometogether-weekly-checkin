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
import type {
  CheckinRepository,
  DispatchCandidate,
  SubmitResult,
  SupportCaseActionInput,
} from "@/lib/checkin/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessagingResult } from "@/lib/messaging/provider";

// Supabase relationships are intentionally ungenerated in this standalone
// feature package; runtime rows are normalized immediately by mapping helpers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRow = Record<string, any>;

const DAY_MS = 24 * 60 * 60 * 1000;

function configuredMessagingProvider(): "kakao" | "mock" {
  const kakaoReady = Boolean(
    process.env.KAKAO_API_BASE_URL &&
      process.env.KAKAO_API_KEY &&
      process.env.KAKAO_SENDER_KEY &&
      process.env.KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE,
  );
  return process.env.MESSAGING_PROVIDER === "kakao" && kakaoReady ? "kakao" : "mock";
}

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

  private async claimDeliveries(provider: string): Promise<DispatchCandidate[]> {
    const leaseOwner = `vercel-${randomUUID()}`;
    const { data, error } = await this.supabase.rpc("claim_message_deliveries", {
      p_provider: provider,
      p_lease_owner: leaseOwner,
      p_limit: 100,
      p_lease_seconds: 120,
    });
    if (error) throw error;
    const claims = (data ?? []) as JsonRow[];
    if (!claims.length) return [];

    const invitationIds = claims.map((claim) => claim.invitation_id);
    const { data: invitationRows, error: invitationError } = await this.supabase
      .from("weekly_checkin_invitations")
      .select("id,run_id,match_id,participant_id,role,token_hash,status,expires_at")
      .in("id", invitationIds);
    if (invitationError) throw invitationError;
    const invitationMap = new Map(
      ((invitationRows ?? []) as JsonRow[]).map((row) => [row.id as string, row]),
    );

    const candidates: DispatchCandidate[] = [];
    for (const claim of claims) {
      const invitation = invitationMap.get(claim.invitation_id);
      if (!invitation) continue;
      const context = `weekly:${claim.week_start}:${claim.participant_id}`;
      const rawToken = createOpaqueTokenForContext(context);
      if (hashToken(rawToken) !== claim.token_hash) {
        const { error: completionError } = await this.supabase.rpc("complete_message_delivery", {
          p_message_log_id: claim.message_log_id,
          p_lease_owner: leaseOwner,
          p_success: false,
          p_error_code: "TOKEN_RECONSTRUCTION_MISMATCH",
          p_error_message_sanitized: "Token cannot be reconstructed; rotate invitation token.",
          p_retryable: false,
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
        recipientName: claim.recipient_name,
        phone: claim.phone,
        counterpartLabel: claim.participant_role === "HOST" ? "학생분" : "집주인분",
        period: formatDateRange(claim.week_start, claim.week_end),
        deadline: formatDeadline(claim.expires_at),
        idempotencyKey: claim.idempotency_key,
        messageLogId: claim.message_log_id,
        deliveryLeaseOwner: leaseOwner,
        messageType: claim.message_type,
      });
    }
    return candidates;
  }

  async createWeeklyInvitations(now: Date): Promise<DispatchCandidate[]> {
    const provider = configuredMessagingProvider();
    const { weekStart, weekEnd } = getKoreanWeek(now);
    const expiresAt = calculateInvitationExpiry(now);
    const { data: matches, error } = await this.supabase
      .from("matches")
      .select(
        "id,host_id,guest_id,status,move_in_date,move_out_date,contract_end_date,host:profiles!matches_host_id_fkey(id,is_active),guest:profiles!matches_guest_id_fkey(id,is_active)",
      )
      .in("status", ["ACTIVE", "MOVE_OUT_SCHEDULED"]);
    if (error) throw error;

    const candidates: Array<{
      match_id: string;
      participant_id: string;
      role: "HOST" | "GUEST";
      token_hash: string;
    }> = [];
    for (const match of (matches ?? []) as JsonRow[]) {
      for (const [role, participantId] of [
        ["HOST", match.host_id],
        ["GUEST", match.guest_id],
      ] as const) {
        const rawToken = createOpaqueTokenForContext(`weekly:${weekStart}:${participantId}`);
        candidates.push({
          match_id: match.id,
          participant_id: participantId,
          role,
          token_hash: hashToken(rawToken),
        });
      }
    }

    const { data: batchRows, error: batchError } = await this.supabase.rpc(
      "create_weekly_checkin_batch",
      {
        p_week_start: weekStart,
        p_week_end: weekEnd,
        p_send_at: now.toISOString(),
        p_reminder_at: new Date(now.getTime() + DAY_MS).toISOString(),
        p_expires_at: expiresAt.toISOString(),
        p_candidates: candidates,
        p_provider: provider,
      },
    );
    if (batchError) throw batchError;

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

    return this.claimDeliveries(provider);
  }

  async createReminderCandidates(now: Date): Promise<DispatchCandidate[]> {
    if (process.env.ENABLE_CHECKIN_REMINDERS === "false") return [];
    const provider = configuredMessagingProvider();
    const { data: runs, error } = await this.supabase
      .from("weekly_checkin_runs")
      .select("id")
      .lte("reminder_at", now.toISOString())
      .gt("expires_at", now.toISOString());
    if (error) throw error;
    for (const run of (runs ?? []) as JsonRow[]) {
      const { error: enqueueError } = await this.supabase.rpc("enqueue_weekly_checkin_reminders", {
        p_run_id: run.id,
        p_provider: provider,
      });
      if (enqueueError) throw enqueueError;
    }
    return this.claimDeliveries(provider);
  }

  async recordMessageResult(
    candidate: DispatchCandidate,
    _messageType: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER",
    _provider: string,
    result: MessagingResult,
  ): Promise<void> {
    if (!candidate.messageLogId || !candidate.deliveryLeaseOwner) {
      throw new Error("Supabase delivery claim metadata is missing");
    }
    const retryable =
      !result.success &&
      Boolean(
        result.errorCode?.includes("NETWORK") ||
          result.errorCode?.includes("TIMEOUT") ||
          result.errorCode?.includes("429") ||
          result.errorCode?.includes("HTTP_5"),
      );
    const { error } = await this.supabase.rpc("complete_message_delivery", {
      p_message_log_id: candidate.messageLogId,
      p_lease_owner: candidate.deliveryLeaseOwner,
      p_success: result.success,
      p_provider_message_id: result.providerMessageId ?? null,
      p_error_code: result.errorCode ?? null,
      p_error_message_sanitized: result.errorMessage?.slice(0, 500) ?? null,
      p_retryable: retryable,
      p_next_attempt_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    });
    if (error) throw error;
  }

  async getDashboard(): Promise<DashboardData> {
    const [invitationsResult, responsesResult, casesResult, messagesResult, runsResult, signalsResult] =
      await Promise.all([
        this.supabase
          .from("weekly_checkin_invitations")
          .select(
            "*, participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name), run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end)",
          ),
        this.supabase.from("weekly_checkin_responses").select("*"),
        this.supabase
          .from("support_cases")
          .select("*, events:support_case_events(id,action,admin_id,created_at)"),
        this.supabase.from("message_logs").select("invitation_id,status,message_type,is_test"),
        this.supabase
          .from("weekly_checkin_runs")
          .select("id,week_start,week_end")
          .order("week_start", { ascending: false })
          .limit(1),
        this.supabase
          .from("weekly_checkin_signals")
          .select("run_id,invitation_id,signal_type,is_test"),
      ]);
    const error =
      invitationsResult.error ??
      responsesResult.error ??
      casesResult.error ??
      messagesResult.error ??
      runsResult.error ??
      signalsResult.error;
    if (error) throw error;

    const invitations = (invitationsResult.data ?? []) as JsonRow[];
    const responseRows = (responsesResult.data ?? []) as JsonRow[];
    const caseRows = (casesResult.data ?? []) as JsonRow[];
    const invitationMap = new Map(invitations.map((row) => [row.id, row]));
    const responseInvitationMap = new Map(
      responseRows.map((row) => [row.id as string, invitationMap.get(row.invitation_id)]),
    );
    const supportCases = caseRows
      .map((row) => mapSupportCase(row, isTestInvitation(responseInvitationMap.get(row.response_id)))!)
      .filter(Boolean);
    const caseMap = new Map(supportCases.map((supportCase) => [supportCase.responseId, supportCase]));
    const riskCounts: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
    const categoryCounts: Record<string, number> = {};
    const responses: DashboardResponseRow[] = responseRows.map((row) => {
      const response = mapResponse(row);
      const invitation = invitationMap.get(response.invitationId);
      return {
        ...response,
        recipientName: first(invitation?.participant)?.display_name ?? "응답자",
        period: invitation?.run
          ? formatDateRange(first(invitation.run)!.week_start, first(invitation.run)!.week_end)
          : "이번 주",
        isTest: isTestInvitation(invitation),
        supportCase: caseMap.get(response.id),
      };
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
    const signals = ((signalsResult.data ?? []) as JsonRow[]).filter(
      (row) =>
        (!latestRun || row.run_id === latestRun.id) &&
        row.is_test !== true &&
        (!row.invitation_id || !isTestInvitation(invitationMap.get(row.invitation_id))),
    );
    const currentMessages = ((messagesResult.data ?? []) as JsonRow[]).filter((row) =>
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
        repeatedIssueCount: signals.filter((row) => row.signal_type === "REPEATED_SUBCATEGORY").length,
        consecutiveNonResponseCount: signals.filter(
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
    return (await this.getDashboard()).responses.find((item) => item.id === responseId) ?? null;
  }

  async getSupportCase(caseId: string): Promise<SupportCaseSummary | null> {
    return (await this.getDashboard()).supportCases.find((item) => item.id === caseId) ?? null;
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
        "participant_id,role,token_hash,run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start),participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return ((data ?? []) as JsonRow[]).flatMap((row) => {
      const run = first(row.run);
      const participant = first(row.participant);
      if (!run) return [];
      const urlToken = createOpaqueTokenForContext(`weekly:${run.week_start}:${row.participant_id}`);
      if (hashToken(urlToken) !== row.token_hash) return [];
      return [{ label: `${participant?.display_name ?? "응답자"} · ${run.week_start}`, urlToken, role: row.role }];
    });
  }
}
