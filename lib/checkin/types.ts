export const QUESTIONNAIRE_VERSION = "2026-08-v1" as const;

export const roles = ["HOST", "GUEST"] as const;
export type ParticipantRole = (typeof roles)[number];

export const riskLevels = ["GREEN", "YELLOW", "ORANGE", "RED"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const overallStatuses = [
  "VERY_GOOD",
  "GOOD",
  "SLIGHTLY_UNCOMFORTABLE",
  "VERY_UNCOMFORTABLE",
  "NEED_HELP_NOW",
] as const;
export type OverallStatus = (typeof overallStatuses)[number];

export const issueStatuses = [
  "NO_ISSUE",
  "RESOLVED",
  "UNRESOLVED",
  "REPEATED",
  "WORSENING",
] as const;
export type IssueStatus = (typeof issueStatuses)[number];

export const positivePointValues = [
  "PRIVACY_RESPECTED",
  "COMMUNICATION_GOOD",
  "CLEANLINESS_GOOD",
  "RULES_FOLLOWED",
  "SHARED_SPACE_GOOD",
  "NO_SPECIAL_EVENT",
  "SKIP",
] as const;
export type PositivePoint = (typeof positivePointValues)[number];

export const issueCategories = [
  "CLEANLINESS",
  "SHARED_SPACE",
  "NOISE_SLEEP",
  "HOUSE_RULES",
  "PRIVACY_BOUNDARY",
  "COMMUNICATION",
  "CARE_PRESSURE",
  "PAYMENT_CONTRACT",
  "FACILITY_REPAIR",
  "SAFETY",
  "UNKNOWN",
] as const;
export type IssueCategory = (typeof issueCategories)[number];

export const frequencies = [
  "ONCE",
  "TWO_OR_THREE",
  "SEVERAL_TIMES",
  "ALMOST_DAILY",
  "ONGOING",
  "UNKNOWN",
] as const;
export type Frequency = (typeof frequencies)[number];

export const discussionStatuses = [
  "NOT_DISCLOSED",
  "DONT_KNOW_HOW",
  "DISCUSSED_RESOLVED",
  "DISCUSSED_UNRESOLVED",
  "WORSENED_AFTER_DISCUSSION",
  "DIFFICULT_TO_DISCUSS",
] as const;
export type DiscussionStatus = (typeof discussionStatuses)[number];

export const desiredActions = [
  "RECORD_ONLY",
  "COMMUNICATION_GUIDE",
  "RULE_REMINDER_TO_BOTH",
  "ANONYMOUS_SUMMARY",
  "CHAT_MEDIATION",
  "PHONE_CONSULT",
  "CONTRACT_REVIEW",
  "RELOCATION_EXIT_CONSULT",
  "URGENT_CONTACT",
] as const;
export type DesiredAction = (typeof desiredActions)[number];

export const disclosurePreferences = [
  "OPS_ONLY",
  "CONTACT_BEFORE_SHARE",
  "SUMMARY_WITHOUT_NAME",
  "SHARE_WITH_NAME",
  "DO_NOT_SHARE",
] as const;
export type DisclosurePreference = (typeof disclosurePreferences)[number];

export const contactMethods = ["KAKAO", "PHONE", "SMS", "NO_CONTACT"] as const;
export type ContactMethod = (typeof contactMethods)[number];

export const contactWindows = [
  "WEEKDAY_10_12",
  "WEEKDAY_12_15",
  "WEEKDAY_15_18",
  "WEEKDAY_18_20",
  "WEEKEND",
  "ANY_TIME",
  "NOW",
] as const;
export type ContactWindow = (typeof contactWindows)[number];

export const immediateDangerValues = [
  "IMMEDIATE_DANGER",
  "CONCERNED_BUT_NOT_IMMEDIATE",
  "NOT_IMMEDIATE",
  "UNSURE",
] as const;
export type ImmediateDanger = (typeof immediateDangerValues)[number];

export const safeToContactValues = [
  "PHONE_OK_NOW",
  "KAKAO_ONLY",
  "SMS_ONLY",
  "NOT_SAFE_TO_CONTACT_NOW",
  "CONTACT_LATER",
] as const;
export type SafeToContact = (typeof safeToContactValues)[number];

export const safeLocationValues = ["YES", "NO", "UNSURE", "PREFER_NOT_TO_ANSWER"] as const;
export type SafeLocation = (typeof safeLocationValues)[number];

export type ClarificationPreference = "CONTACT_TO_EXPLAIN" | "RECORD_WITHOUT_DETAILS";

export interface CheckinIssueInput {
  category: IssueCategory;
  subcategory: string;
  frequency: Frequency;
  severity: 1 | 2 | 3 | 4 | 5;
  discussionStatus: DiscussionStatus;
  desiredAction: DesiredAction;
  clarificationPreference?: ClarificationPreference;
  additionalNote?: string;
}

export interface SafetyAnswers {
  immediateDanger: ImmediateDanger;
  safeToContact: SafeToContact;
  safeLocation: SafeLocation;
}

export interface CheckinSubmission {
  questionnaireVersion: typeof QUESTIONNAIRE_VERSION;
  overallStatus: OverallStatus;
  issueStatus?: IssueStatus;
  positivePoints: PositivePoint[];
  issues: CheckinIssueInput[];
  disclosurePreference?: DisclosurePreference;
  contactMethod?: ContactMethod;
  contactWindow?: ContactWindow;
  safety?: SafetyAnswers;
  questionSnapshot: Record<string, unknown>;
}

export interface RiskHistoryContext {
  repeatedSubcategories?: string[];
  consecutiveMissedWeeks?: number;
  counterpartRiskLevel?: RiskLevel;
}

export interface RiskResult {
  riskLevel: RiskLevel;
  riskReasons: string[];
  pairedMismatch: boolean;
  requiresSupportCase: boolean;
}

export type InvitationStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "OPENED"
  | "COMPLETED"
  | "EXPIRED";

export interface PublicInvitation {
  id: string;
  recipientName: string;
  role: ParticipantRole;
  period: string;
  expiresAt: string;
  status: InvitationStatus;
  completedAt?: string;
  draft?: Partial<CheckinSubmission>;
}

export interface StoredInvitation extends PublicInvitation {
  runId: string;
  matchId: string;
  participantId: string;
  tokenHash: string;
  phone: string;
  sentAt?: string;
  reminderSentAt?: string;
  openedAt?: string;
  /** The invitation is the authoritative source for test-data classification. */
  isTest?: boolean;
}

export interface StoredResponse {
  id: string;
  invitationId: string;
  matchId: string;
  participantId: string;
  role: ParticipantRole;
  submission: CheckinSubmission;
  riskLevel: RiskLevel;
  riskReasons: string[];
  pairedMismatch: boolean;
  submittedAt: string;
}

export type SupportCaseStatus =
  | "UNACKNOWLEDGED"
  | "OPEN"
  | "CONTACTED"
  | "MEDIATING"
  | "MONITORING"
  | "RESOLVED"
  | "CLOSED";

export interface SupportCaseSummary {
  id: string;
  responseId: string;
  matchId: string;
  participantId: string;
  priority: RiskLevel;
  status: SupportCaseStatus;
  assignedAdminId?: string;
  acknowledgementAt?: string;
  firstContactAt?: string;
  resolvedAt?: string;
  resolutionCode?: string;
  internalNote?: string;
  events?: Array<{
    id: string;
    action: string;
    adminId?: string;
    createdAt: string;
  }>;
  createdAt: string;
  /** Derived from the related weekly_checkin_invitations.is_test flag. */
  isTest: boolean;
}

export interface DashboardResponseRow extends StoredResponse {
  recipientName: string;
  period: string;
  /** Derived from the related weekly_checkin_invitations.is_test flag. */
  isTest: boolean;
  supportCase?: SupportCaseSummary;
}

export interface DashboardStats {
  targetCount: number;
  sentCount: number;
  failedCount: number;
  completedCount: number;
  hostResponseRate: number;
  guestResponseRate: number;
  riskCounts: Record<RiskLevel, number>;
  unacknowledgedCritical: number;
  categoryCounts: Record<string, number>;
  repeatedIssueCount: number;
  consecutiveNonResponseCount: number;
  pairedMismatchCount: number;
}

export interface DashboardData {
  period: string;
  stats: DashboardStats;
  responses: DashboardResponseRow[];
  supportCases: SupportCaseSummary[];
}
