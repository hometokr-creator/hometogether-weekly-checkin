import "server-only";

import { randomUUID } from "node:crypto";

import { calculateInvitationExpiry, createOpaqueToken, hashToken } from "@/lib/checkin/token";
import { isPairedRiskMismatch } from "@/lib/checkin/calculate-risk";
import {
  QUESTIONNAIRE_VERSION,
  type CheckinSubmission,
  type DashboardData,
  type DashboardResponseRow,
  type PublicInvitation,
  type RiskHistoryContext,
  type RiskResult,
  type StoredInvitation,
  type StoredResponse,
  type SupportCaseSummary,
} from "@/lib/checkin/types";
import type {
  CheckinRepository,
  DispatchCandidate,
  SubmitResult,
  SupportCaseActionInput,
} from "@/lib/checkin/repository";
import { maskPhone, type MessagingResult } from "@/lib/messaging/provider";

interface Participant {
  id: string;
  displayName: string;
  phone: string;
  role: "HOST" | "GUEST";
}

interface MatchRecord {
  id: string;
  hostId: string;
  guestId: string;
  status: "ACTIVE" | "PRE_MOVE_IN" | "MOVED_OUT" | "CONTRACT_ENDED";
  moveInAt: string;
  moveOutAt?: string;
  contractEndAt?: string;
}

interface RunRecord {
  id: string;
  weekStart: string;
  weekEnd: string;
  sendAt: string;
  reminderAt: string;
  expiresAt: string;
  status: string;
}

interface MessageLogRecord {
  id: string;
  invitationId: string;
  provider: string;
  messageType: string;
  recipientMasked: string;
  idempotencyKey: string;
  providerMessageId?: string;
  status: "SENT" | "FAILED";
  errorCode?: string;
  errorMessageSanitized?: string;
  attemptCount: number;
  createdAt: string;
}

interface MemoryState {
  participants: Map<string, Participant>;
  matches: Map<string, MatchRecord>;
  runs: Map<string, RunRecord>;
  invitations: Map<string, StoredInvitation>;
  responses: Map<string, StoredResponse>;
  supportCases: Map<string, SupportCaseSummary>;
  messageLogs: Map<string, MessageLogRecord>;
  pendingDeliveries: Map<string, DispatchCandidate>;
  developmentTokens: Map<string, { label: string; role: string }>;
}

export interface MemoryRepositoryTestSnapshot {
  runs: RunRecord[];
  invitations: StoredInvitation[];
  responses: StoredResponse[];
  supportCases: SupportCaseSummary[];
  messageLogs: MessageLogRecord[];
}

const DEMO_SCENARIOS = [
  ["정상 체크인 · 집주인", "demo-normal-host", "HOST"],
  ["정상 체크인 · 학생", "demo-normal-guest", "GUEST"],
  ["위생 불편 · 학생", "demo-cleanliness-guest", "GUEST"],
  ["생활지원 부담 · 학생", "demo-care-pressure-guest", "GUEST"],
  ["긴급 안전 · 학생", "demo-safety-guest", "GUEST"],
  ["평가 차이 · 집주인", "demo-mismatch-host", "HOST"],
] as const;

function iso(date: Date) {
  return date.toISOString();
}

function getKoreanWeek(now: Date) {
  const kstOffset = 9 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + kstOffset);
  const day = local.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const weekStart = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday) -
      kstOffset,
  );
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
  return { weekStart, weekEnd };
}

function formatPeriod(start: Date, end: Date) {
  const format = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  });
  return `${format.format(start)} ~ ${format.format(end)}`;
}

function formatDeadline(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function seedState(): MemoryState {
  const state: MemoryState = {
    participants: new Map(),
    matches: new Map(),
    runs: new Map(),
    invitations: new Map(),
    responses: new Map(),
    supportCases: new Map(),
    messageLogs: new Map(),
    pendingDeliveries: new Map(),
    developmentTokens: new Map(),
  };

  const demoRun: RunRecord = {
    id: "demo-run",
    weekStart: "2026-07-27T15:00:00.000Z",
    weekEnd: "2026-08-02T14:59:59.999Z",
    sendAt: "2026-08-02T09:00:00.000Z",
    reminderAt: "2026-08-03T09:00:00.000Z",
    expiresAt: "2099-08-05T15:00:00.000Z",
    status: "SENT",
  };
  state.runs.set(demoRun.id, demoRun);

  for (let index = 0; index < 6; index += 1) {
    const matchId = `demo-match-${index + 1}`;
    const host: Participant = {
      id: `demo-host-${index + 1}`,
      displayName: `집주인 ${index + 1}`,
      phone: `+82101000${String(1000 + index).slice(-4)}`,
      role: "HOST",
    };
    const guest: Participant = {
      id: `demo-guest-${index + 1}`,
      displayName: `학생 ${index + 1}`,
      phone: `+82102000${String(2000 + index).slice(-4)}`,
      role: "GUEST",
    };
    state.participants.set(host.id, host);
    state.participants.set(guest.id, guest);
    state.matches.set(matchId, {
      id: matchId,
      hostId: host.id,
      guestId: guest.id,
      status: "ACTIVE",
      moveInAt: "2026-01-01T00:00:00.000Z",
      contractEndAt: "2099-12-31T23:59:59.999Z",
    });
  }

  DEMO_SCENARIOS.forEach(([label, token, role], index) => {
    const matchId = `demo-match-${index + 1}`;
    const participantId = role === "HOST" ? `demo-host-${index + 1}` : `demo-guest-${index + 1}`;
    const participant = state.participants.get(participantId)!;
    const tokenHash = hashToken(token);
    state.developmentTokens.set(token, { label, role });
    state.invitations.set(tokenHash, {
      id: `demo-invitation-${index + 1}`,
      runId: demoRun.id,
      matchId,
      participantId,
      role,
      tokenHash,
      recipientName: participant.displayName,
      phone: participant.phone,
      period: "7월 27일 ~ 8월 2일",
      expiresAt: demoRun.expiresAt,
      status: "SENT",
      sentAt: demoRun.sendAt,
    });
  });

  // Seed one completed RED response so the urgent admin workflow is visible
  // before a developer submits a new scenario.
  const seededSubmission: CheckinSubmission = {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "NEED_HELP_NOW",
    issueStatus: "UNRESOLVED",
    positivePoints: [],
    issues: [
      {
        category: "SAFETY",
        subcategory: "AFRAID_TO_STAY",
        frequency: "ONGOING",
        severity: 5,
        discussionStatus: "DIFFICULT_TO_DISCUSS",
        desiredAction: "URGENT_CONTACT",
      },
    ],
    safety: {
      immediateDanger: "CONCERNED_BUT_NOT_IMMEDIATE",
      safeToContact: "KAKAO_ONLY",
      safeLocation: "YES",
    },
    disclosurePreference: "OPS_ONLY",
    contactMethod: "KAKAO",
    contactWindow: "NOW",
    questionSnapshot: { seeded: true },
  };
  const seededResponse: StoredResponse = {
    id: "demo-response-red",
    invitationId: "demo-seeded-red-invitation",
    matchId: "demo-match-4",
    participantId: "demo-guest-4",
    role: "GUEST",
    submission: seededSubmission,
    riskLevel: "RED",
    riskReasons: ["NEED_HELP_NOW", "SAFETY_CATEGORY", "SEVERITY_5"],
    pairedMismatch: false,
    submittedAt: "2026-08-02T10:00:00.000Z",
  };
  state.responses.set(seededResponse.id, seededResponse);
  state.supportCases.set("demo-case-red", {
    id: "demo-case-red",
    responseId: seededResponse.id,
    matchId: seededResponse.matchId,
    participantId: seededResponse.participantId,
    priority: "RED",
    status: "UNACKNOWLEDGED",
    createdAt: seededResponse.submittedAt,
    isTest: false,
  });

  return state;
}

const globalForMemory = globalThis as typeof globalThis & {
  __homeTogetherCheckinMemory?: MemoryState;
};

function getState(): MemoryState {
  if (!globalForMemory.__homeTogetherCheckinMemory) {
    globalForMemory.__homeTogetherCheckinMemory = seedState();
  }
  return globalForMemory.__homeTogetherCheckinMemory;
}

function resetMemoryRepositoryState(): void {
  const seeded = seedState();
  const current = globalForMemory.__homeTogetherCheckinMemory;
  if (!current) {
    globalForMemory.__homeTogetherCheckinMemory = seeded;
    return;
  }

  current.participants = seeded.participants;
  current.matches = seeded.matches;
  current.runs = seeded.runs;
  current.invitations = seeded.invitations;
  current.responses = seeded.responses;
  current.supportCases = seeded.supportCases;
  current.messageLogs = seeded.messageLogs;
  current.pendingDeliveries = seeded.pendingDeliveries;
  current.developmentTokens = seeded.developmentTokens;
}

/**
 * Keeps the memory adapter deterministic across integration tests, including
 * repository instances cached by repository-factory.
 */
export function resetMemoryRepositoryForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Memory repository test reset is available only in tests");
  }

  resetMemoryRepositoryState();
}

/**
 * Resets the local demo adapter for repeatable browser tests. The matching API
 * route returns 404 in production, so this cannot mutate a deployed service.
 */
export function resetMemoryRepositoryForDevelopment(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Memory repository development reset is unavailable in production");
  }

  resetMemoryRepositoryState();
}

/** Read-only copies for assertions that cannot be observed through the UI. */
export function getMemoryRepositoryTestSnapshot(): MemoryRepositoryTestSnapshot {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Memory repository inspection is available only in tests");
  }

  const state = getState();
  return {
    runs: structuredClone([...state.runs.values()]),
    invitations: structuredClone([...state.invitations.values()]),
    responses: structuredClone([...state.responses.values()]),
    supportCases: structuredClone([...state.supportCases.values()]),
    messageLogs: structuredClone([...state.messageLogs.values()]),
  };
}

function toPublic(invitation: StoredInvitation): PublicInvitation {
  return {
    id: invitation.id,
    recipientName: invitation.recipientName,
    role: invitation.role,
    period: invitation.period,
    expiresAt: invitation.expiresAt,
    status: invitation.status,
    completedAt: invitation.completedAt,
    draft: invitation.draft,
  };
}

export class MemoryCheckinRepository implements CheckinRepository {
  private readonly state = getState();

  async findInvitation(tokenHash: string, markOpened = true): Promise<PublicInvitation | null> {
    const invitation = this.state.invitations.get(tokenHash);
    if (!invitation) return null;
    if (markOpened && invitation.status === "SENT") {
      invitation.status = "OPENED";
      invitation.openedAt = iso(new Date());
    }
    return toPublic(invitation);
  }

  async saveDraft(tokenHash: string, answers: Record<string, unknown>): Promise<PublicInvitation> {
    const invitation = this.state.invitations.get(tokenHash);
    if (!invitation) throw new Error("INVITATION_NOT_FOUND");
    if (invitation.status === "COMPLETED") return toPublic(invitation);
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw new Error("INVITATION_EXPIRED");
    invitation.draft = answers;
    if (invitation.status === "SENT") invitation.status = "OPENED";
    return toPublic(invitation);
  }

  async getRiskHistory(tokenHash: string): Promise<RiskHistoryContext> {
    const invitation = this.state.invitations.get(tokenHash);
    if (!invitation) return {};
    const ownPrevious = [...this.state.responses.values()]
      .filter(
        (response) =>
          response.participantId === invitation.participantId &&
          response.invitationId !== invitation.id,
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    const counterpart = [...this.state.responses.values()]
      .filter(
        (response) =>
          response.matchId === invitation.matchId &&
          response.participantId !== invitation.participantId,
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];

    return {
      repeatedSubcategories: ownPrevious?.submission.issues.map((issue) => issue.subcategory) ?? [],
      counterpartRiskLevel: counterpart?.riskLevel,
      consecutiveMissedWeeks: 0,
    };
  }

  async submit(
    tokenHash: string,
    submission: CheckinSubmission,
    risk: RiskResult,
  ): Promise<SubmitResult> {
    const invitation = this.state.invitations.get(tokenHash);
    if (!invitation) throw new Error("INVITATION_NOT_FOUND");

    const existing = [...this.state.responses.values()].find(
      (response) => response.invitationId === invitation.id,
    );
    if (existing) {
      const supportCase = [...this.state.supportCases.values()].find(
        (item) => item.responseId === existing.id,
      );
      return { response: existing, supportCase, alreadyCompleted: true };
    }

    if (new Date(invitation.expiresAt).getTime() <= Date.now()) throw new Error("INVITATION_EXPIRED");

    const counterpart = [...this.state.responses.values()].find(
      (item) =>
        item.matchId === invitation.matchId &&
        item.participantId !== invitation.participantId,
    );
    const pairedMismatch =
      risk.pairedMismatch || isPairedRiskMismatch(risk.riskLevel, counterpart?.riskLevel);
    const riskLevel = pairedMismatch && risk.riskLevel === "GREEN" ? "YELLOW" : risk.riskLevel;
    const riskReasons = pairedMismatch
      ? [...new Set([...risk.riskReasons, "PAIRED_RISK_MISMATCH"])]
      : risk.riskReasons;

    const response: StoredResponse = {
      id: randomUUID(),
      invitationId: invitation.id,
      matchId: invitation.matchId,
      participantId: invitation.participantId,
      role: invitation.role,
      submission,
      riskLevel,
      riskReasons,
      pairedMismatch,
      submittedAt: iso(new Date()),
    };
    this.state.responses.set(response.id, response);
    invitation.status = "COMPLETED";
    invitation.completedAt = response.submittedAt;
    invitation.draft = undefined;

    if (pairedMismatch && counterpart) {
      counterpart.pairedMismatch = true;
      counterpart.riskReasons = [
        ...new Set([...counterpart.riskReasons, "PAIRED_RISK_MISMATCH"]),
      ];
      if (counterpart.riskLevel === "GREEN") counterpart.riskLevel = "YELLOW";
    }

    let supportCase: SupportCaseSummary | undefined;
    if (risk.requiresSupportCase) {
      supportCase = {
        id: randomUUID(),
        responseId: response.id,
        matchId: response.matchId,
        participantId: response.participantId,
        priority: "RED",
        status: "UNACKNOWLEDGED",
        createdAt: response.submittedAt,
        isTest: invitation.isTest === true,
      };
      this.state.supportCases.set(supportCase.id, supportCase);
    }

    return { response, supportCase, alreadyCompleted: false };
  }

  async createWeeklyInvitations(now: Date): Promise<DispatchCandidate[]> {
    const { weekStart, weekEnd } = getKoreanWeek(now);
    const weekKey = weekStart.toISOString().slice(0, 10);
    let run = [...this.state.runs.values()].find((item) => item.weekStart === iso(weekStart));
    if (!run) {
      const expiresAt = calculateInvitationExpiry(now);
      run = {
        id: randomUUID(),
        weekStart: iso(weekStart),
        weekEnd: iso(weekEnd),
        sendAt: iso(now),
        reminderAt: iso(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
        expiresAt: iso(expiresAt),
        status: "CREATED",
      };
      this.state.runs.set(run.id, run);
    }

    const candidates: DispatchCandidate[] = [];
    for (const match of this.state.matches.values()) {
      if (match.status !== "ACTIVE") continue;
      if (new Date(match.moveInAt) > now) continue;
      if (match.moveOutAt && new Date(match.moveOutAt) <= now) continue;
      if (match.contractEndAt && new Date(match.contractEndAt) <= now) continue;

      for (const participantId of [match.hostId, match.guestId]) {
        const participant = this.state.participants.get(participantId)!;
        const existing = [...this.state.invitations.values()].find(
          (item) => item.runId === run!.id && item.participantId === participant.id,
        );
        if (existing && existing.status !== "FAILED") continue;

        const rawToken = createOpaqueToken();
        const tokenHash = hashToken(rawToken);
        const invitation: StoredInvitation = existing ?? {
          id: randomUUID(),
          runId: run.id,
          matchId: match.id,
          participantId: participant.id,
          role: participant.role,
          tokenHash,
          recipientName: participant.displayName,
          phone: participant.phone,
          period: formatPeriod(weekStart, weekEnd),
          expiresAt: run.expiresAt,
          status: "PENDING",
        };
        if (existing) {
          this.state.invitations.delete(existing.tokenHash);
          invitation.tokenHash = tokenHash;
        }
        invitation.status = "SENDING";
        this.state.invitations.set(tokenHash, invitation);

        candidates.push({
          invitation,
          rawToken,
          recipientId: participant.id,
          recipientName: participant.displayName,
          phone: participant.phone,
          counterpartLabel: participant.role === "HOST" ? "학생분" : "집주인분",
          period: invitation.period,
          deadline: formatDeadline(new Date(invitation.expiresAt)),
          idempotencyKey: `weekly:${weekKey}:${participant.id}:${match.id}:initial`,
        });
      }
    }
    return candidates;
  }

  async createReminderCandidates(now: Date): Promise<DispatchCandidate[]> {
    if (process.env.ENABLE_CHECKIN_REMINDERS === "false") return [];
    const candidates: DispatchCandidate[] = [];
    for (const invitation of this.state.invitations.values()) {
      const run = this.state.runs.get(invitation.runId);
      if (!run || new Date(run.reminderAt) > now) continue;
      if (!["SENT", "OPENED"].includes(invitation.status)) continue;
      if (invitation.reminderSentAt || new Date(invitation.expiresAt) <= now) continue;

      const participant = this.state.participants.get(invitation.participantId)!;
      const rawToken = createOpaqueToken();
      this.state.invitations.delete(invitation.tokenHash);
      invitation.tokenHash = hashToken(rawToken);
      invitation.status = "SENDING";
      this.state.invitations.set(invitation.tokenHash, invitation);

      candidates.push({
        invitation,
        rawToken,
        recipientId: participant.id,
        recipientName: participant.displayName,
        phone: participant.phone,
        counterpartLabel: participant.role === "HOST" ? "학생분" : "집주인분",
        period: invitation.period,
        deadline: formatDeadline(new Date(invitation.expiresAt)),
        idempotencyKey: `weekly:${run.weekStart.slice(0, 10)}:${participant.id}:${invitation.matchId}:reminder`,
      });
    }
    return candidates;
  }

  async enqueueWeeklyMessages(now: Date) {
    const candidates = await this.createWeeklyInvitations(now);
    for (const candidate of candidates) {
      candidate.deliveryScope = "PRODUCTION";
      this.state.pendingDeliveries.set(candidate.idempotencyKey, candidate);
    }
    return { queued: candidates.length, dataQualityCount: 0 };
  }

  async enqueueReminderMessages(now: Date) {
    const candidates = await this.createReminderCandidates(now);
    for (const candidate of candidates) {
      candidate.deliveryScope = "PRODUCTION";
      this.state.pendingDeliveries.set(candidate.idempotencyKey, candidate);
    }
    return { queued: candidates.length, dataQualityCount: 0 };
  }

  async claimMessageDeliveries(options: {
    allowProduction: boolean;
    allowAdminTest: boolean;
    limit: number;
  }): Promise<DispatchCandidate[]> {
    if (!options.allowProduction) return [];
    const claimed = [...this.state.pendingDeliveries.values()].slice(0, options.limit);
    for (const candidate of claimed) {
      this.state.pendingDeliveries.delete(candidate.idempotencyKey);
      candidate.attemptCount = (candidate.attemptCount ?? 0) + 1;
      candidate.maxAttempts = 5;
    }
    return claimed;
  }

  async saveMessageTemplate(
    candidate: DispatchCandidate,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<void> {
    void variables;
    candidate.templateCode = templateCode;
  }

  async recordMessageResult(
    candidate: DispatchCandidate,
    messageType: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER" | "ALIMTALK_TEST",
    provider: string,
    result: MessagingResult,
  ): Promise<void> {
    const existing = this.state.messageLogs.get(candidate.idempotencyKey);
    this.state.messageLogs.set(candidate.idempotencyKey, {
      id: existing?.id ?? randomUUID(),
      invitationId: candidate.invitation?.id ?? "admin-test",
      provider,
      messageType,
      recipientMasked: maskPhone(candidate.phone),
      idempotencyKey: candidate.idempotencyKey,
      providerMessageId: result.providerMessageId,
      status: result.success ? "SENT" : "FAILED",
      errorCode: result.errorCode,
      errorMessageSanitized: result.errorMessage,
      attemptCount: (existing?.attemptCount ?? 0) + 1,
      createdAt: existing?.createdAt ?? iso(new Date()),
    });
    if (candidate.invitation) {
      candidate.invitation.status = result.success ? "SENT" : "FAILED";
    }
    if (result.success && candidate.invitation) {
      if (messageType === "WEEKLY_CHECKIN") candidate.invitation.sentAt = iso(new Date());
      else if (messageType === "WEEKLY_CHECKIN_REMINDER") {
        candidate.invitation.reminderSentAt = iso(new Date());
      }
    }
  }

  async getDashboard(): Promise<DashboardData> {
    const invitations = [...this.state.invitations.values()];
    const responses = [...this.state.responses.values()];
    const supportCases = [...this.state.supportCases.values()];
    const invitationById = new Map(invitations.map((item) => [item.id, item]));
    const isTestResponse = (response: StoredResponse) =>
      invitationById.get(response.invitationId)?.isTest === true;
    const productionInvitations = invitations.filter((item) => item.isTest !== true);
    const productionResponses = responses.filter((response) => !isTestResponse(response));
    const supportCasesWithTestFlag = supportCases.map((supportCase) => {
      const response = responses.find((item) => item.id === supportCase.responseId);
      return { ...supportCase, isTest: response ? isTestResponse(response) : false };
    });
    const productionSupportCases = supportCasesWithTestFlag.filter((item) => !item.isTest);
    const riskCounts = { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 };
    const categoryCounts: Record<string, number> = {};
    for (const response of productionResponses) {
      riskCounts[response.riskLevel] += 1;
      for (const issue of response.submission.issues) {
        categoryCounts[issue.category] = (categoryCounts[issue.category] ?? 0) + 1;
      }
    }
    const hostInvites = productionInvitations.filter((item) => item.role === "HOST");
    const guestInvites = productionInvitations.filter((item) => item.role === "GUEST");
    const hostCompleted = hostInvites.filter((item) => item.status === "COMPLETED").length;
    const guestCompleted = guestInvites.filter((item) => item.status === "COMPLETED").length;

    const rows: DashboardResponseRow[] = responses.map((response) => {
      const invitation = invitationById.get(response.invitationId);
      const participant = this.state.participants.get(response.participantId);
      return {
        ...response,
        recipientName: participant?.displayName ?? invitation?.recipientName ?? "응답자",
        period: invitation?.period ?? "이번 주",
        isTest: invitation?.isTest === true,
        supportCase: supportCasesWithTestFlag.find((item) => item.responseId === response.id),
      };
    });
    rows.sort((a, b) => {
      const urgentA = a.riskLevel === "RED" && a.supportCase?.status === "UNACKNOWLEDGED" ? 1 : 0;
      const urgentB = b.riskLevel === "RED" && b.supportCase?.status === "UNACKNOWLEDGED" ? 1 : 0;
      return urgentB - urgentA || b.submittedAt.localeCompare(a.submittedAt);
    });

    return {
      period: productionInvitations[0]?.period ?? invitations[0]?.period ?? "이번 주",
      stats: {
        targetCount: productionInvitations.length,
        sentCount: productionInvitations.filter((item) =>
          ["SENT", "OPENED", "COMPLETED"].includes(item.status),
        ).length,
        failedCount: productionInvitations.filter((item) => item.status === "FAILED").length,
        completedCount: productionResponses.length,
        hostResponseRate: hostInvites.length ? Math.round((hostCompleted / hostInvites.length) * 100) : 0,
        guestResponseRate: guestInvites.length
          ? Math.round((guestCompleted / guestInvites.length) * 100)
          : 0,
        riskCounts,
        unacknowledgedCritical: productionSupportCases.filter(
          (item) => item.priority === "RED" && item.status === "UNACKNOWLEDGED",
        ).length,
        categoryCounts,
        repeatedIssueCount: productionResponses.filter((item) =>
          item.riskReasons.some((reason) => reason.startsWith("REPEATED_")),
        ).length,
        consecutiveNonResponseCount: 0,
        pairedMismatchCount: productionResponses.filter((item) => item.pairedMismatch).length,
      },
      responses: rows,
      supportCases: supportCasesWithTestFlag.sort((a, b) => {
        const urgentA = a.status === "UNACKNOWLEDGED" && a.priority === "RED" ? 1 : 0;
        const urgentB = b.status === "UNACKNOWLEDGED" && b.priority === "RED" ? 1 : 0;
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
    const supportCase = this.state.supportCases.get(caseId);
    if (!supportCase) return null;
    const now = iso(new Date());
    if (input.action === "ACKNOWLEDGE") {
      supportCase.acknowledgementAt ??= now;
      supportCase.status = "OPEN";
    } else if (input.action === "ASSIGN") {
      supportCase.assignedAdminId = input.assignedAdminId ?? adminId;
      if (supportCase.status === "UNACKNOWLEDGED") supportCase.status = "OPEN";
    } else if (["KAKAO_PLANNED", "PHONE_COMPLETED"].includes(input.action)) {
      supportCase.status = "CONTACTED";
      supportCase.firstContactAt ??= now;
    } else if (input.action === "START_MEDIATION") {
      supportCase.status = "MEDIATING";
    } else if (input.action === "MONITOR") {
      supportCase.status = "MONITORING";
    } else if (input.action === "RESOLVE") {
      supportCase.status = "RESOLVED";
      supportCase.resolvedAt ??= now;
    } else if (input.action === "CLOSE") {
      supportCase.status = "CLOSED";
      supportCase.resolvedAt ??= now;
    }
    if (input.resolutionCode) supportCase.resolutionCode = input.resolutionCode;
    if (input.internalNote) supportCase.internalNote = input.internalNote;
    supportCase.events = [
      ...(supportCase.events ?? []),
      { id: randomUUID(), action: input.action, adminId, createdAt: now },
    ];
    return this.getSupportCase(caseId);
  }

  async listDevelopmentLinks() {
    if (process.env.NODE_ENV === "production") return [];
    return [...this.state.developmentTokens.entries()].map(([urlToken, item]) => ({
      label: item.label,
      urlToken,
      role: item.role,
    }));
  }
}
