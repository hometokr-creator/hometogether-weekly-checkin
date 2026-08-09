import "server-only";

import type {
  CheckinSubmission,
  DashboardData,
  DashboardResponseRow,
  PublicInvitation,
  RiskHistoryContext,
  RiskResult,
  StoredInvitation,
  StoredResponse,
  SupportCaseSummary,
} from "@/lib/checkin/types";
import type { MessagingResult } from "@/lib/messaging/provider";

export interface DispatchCandidate {
  invitation?: StoredInvitation;
  rawToken?: string;
  recipientId: string;
  recipientName: string;
  phone: string;
  counterpartLabel: "학생분" | "집주인분" | "공동생활 상대방";
  period: string;
  deadline: string;
  checkinUrl?: string;
  idempotencyKey: string;
  messageLogId?: string;
  deliveryLeaseOwner?: string;
  messageType?: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER" | "ALIMTALK_TEST";
  deliveryScope?: "PRODUCTION" | "ADMIN_TEST";
  templateCode?: string;
  providerMessageId?: string;
  failureClass?: "TRANSIENT" | "PERMANENT" | "UNKNOWN";
  attemptCount?: number;
  maxAttempts?: number;
}

export interface EnqueueSummary {
  queued: number;
  dataQualityCount: number;
}

export interface MessageDeliveryClaimOptions {
  provider: string;
  allowProduction: boolean;
  allowAdminTest: boolean;
  limit: number;
}

export interface SubmitResult {
  response: StoredResponse;
  supportCase?: SupportCaseSummary;
  alreadyCompleted: boolean;
}

export interface SupportCaseActionInput {
  action:
    | "ACKNOWLEDGE"
    | "ASSIGN"
    | "KAKAO_PLANNED"
    | "PHONE_COMPLETED"
    | "RULE_GUIDANCE"
    | "START_MEDIATION"
    | "CONTRACT_CONSULT"
    | "MONITOR"
    | "RESOLVE"
    | "CLOSE";
  assignedAdminId?: string;
  resolutionCode?: string;
  internalNote?: string;
}

export interface CheckinRepository {
  findInvitation(tokenHash: string, markOpened?: boolean): Promise<PublicInvitation | null>;
  saveDraft(tokenHash: string, answers: Record<string, unknown>): Promise<PublicInvitation>;
  getRiskHistory(tokenHash: string): Promise<RiskHistoryContext>;
  submit(
    tokenHash: string,
    submission: CheckinSubmission,
    risk: RiskResult,
  ): Promise<SubmitResult>;

  enqueueWeeklyMessages(now: Date): Promise<EnqueueSummary>;
  enqueueReminderMessages(now: Date): Promise<EnqueueSummary>;
  claimMessageDeliveries(options: MessageDeliveryClaimOptions): Promise<DispatchCandidate[]>;
  saveMessageTemplate(
    candidate: DispatchCandidate,
    templateCode: string,
    variables: Record<string, string>,
  ): Promise<void>;
  recordMessageResult(
    candidate: DispatchCandidate,
    messageType: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER" | "ALIMTALK_TEST",
    provider: string,
    result: MessagingResult,
  ): Promise<void>;

  getDashboard(): Promise<DashboardData>;
  getResponse(responseId: string): Promise<DashboardResponseRow | null>;
  getSupportCase(caseId: string): Promise<SupportCaseSummary | null>;
  updateSupportCase(
    caseId: string,
    adminId: string,
    input: SupportCaseActionInput,
  ): Promise<SupportCaseSummary | null>;
  listDevelopmentLinks(): Promise<Array<{ label: string; urlToken: string; role: string }>>;
}
