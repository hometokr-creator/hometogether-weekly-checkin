import {
  contactMethodOptions,
  contactWindowOptions,
  desiredActionOptions,
  disclosurePreferenceOptions,
  discussionStatusOptions,
  frequencyOptions,
  getSubcategoryOptions,
  immediateDangerOptions,
  issueCategoryOptions,
  issueStatusOptions,
  overallStatusOptions,
  positivePointOptions,
  safeLocationOptions,
  safeToContactOptions,
  severityOptions,
  type QuestionOption,
} from "@/lib/checkin/question-tree";
import type {
  IssueCategory,
  ParticipantRole,
  RiskLevel,
  SupportCaseStatus,
} from "@/lib/checkin/types";

function optionLabel(
  options: readonly QuestionOption<string | number>[],
  value: string | number | undefined,
): string {
  if (value === undefined) return "응답 없음";
  return options.find((option) => option.value === value)?.label ?? String(value);
}

export const labels = {
  overallStatus: (value: string | undefined) => optionLabel(overallStatusOptions, value),
  issueStatus: (value: string | undefined) => optionLabel(issueStatusOptions, value),
  positivePoint: (value: string) => optionLabel(positivePointOptions, value),
  category: (value: string) => optionLabel(issueCategoryOptions, value),
  frequency: (value: string) => optionLabel(frequencyOptions, value),
  discussionStatus: (value: string) => optionLabel(discussionStatusOptions, value),
  desiredAction: (value: string) => optionLabel(desiredActionOptions, value),
  disclosurePreference: (value: string | undefined) =>
    optionLabel(disclosurePreferenceOptions, value),
  contactMethod: (value: string | undefined) => optionLabel(contactMethodOptions, value),
  contactWindow: (value: string | undefined) => optionLabel(contactWindowOptions, value),
  immediateDanger: (value: string | undefined) => optionLabel(immediateDangerOptions, value),
  safeToContact: (value: string | undefined) => optionLabel(safeToContactOptions, value),
  safeLocation: (value: string | undefined) => optionLabel(safeLocationOptions, value),
  severity: (value: number) => optionLabel(severityOptions, value),
};

export function subcategoryLabel(category: IssueCategory, value: string): string {
  return optionLabel(getSubcategoryOptions(category), value);
}

export const roleLabels: Record<ParticipantRole, string> = {
  HOST: "집주인",
  GUEST: "학생",
};

export const riskLabels: Record<RiskLevel, string> = {
  GREEN: "안정",
  YELLOW: "관찰",
  ORANGE: "우선 확인",
  RED: "긴급",
};

export const caseStatusLabels: Record<SupportCaseStatus, string> = {
  UNACKNOWLEDGED: "미확인",
  OPEN: "확인·처리 중",
  CONTACTED: "연락 완료",
  MEDIATING: "중재 중",
  MONITORING: "모니터링",
  RESOLVED: "해결 완료",
  CLOSED: "종료",
};

export const caseActionLabels: Record<string, string> = {
  ACKNOWLEDGE: "확인 완료",
  ASSIGN: "담당자 지정",
  KAKAO_PLANNED: "카카오톡 연락 예정",
  PHONE_COMPLETED: "전화 연락 완료",
  RULE_GUIDANCE: "규칙 안내",
  START_MEDIATION: "중재 시작",
  CONTRACT_CONSULT: "계약 상담",
  MONITOR: "모니터링",
  RESOLVE: "해결 완료",
  CLOSE: "사건 종료",
};

const riskReasonLabels: Record<string, string> = {
  NEED_HELP_NOW: "즉시 도움 요청",
  SAFETY_CATEGORY: "안전·위협 항목 선택",
  SEVERITY_5: "생활 영향도 5단계",
  SEVERITY_4: "생활 영향도 4단계",
  SEVERITY_3: "생활 영향도 3단계",
  IMMEDIATE_DANGER: "현재 즉시 위험",
  WORSENED_AFTER_DISCUSSION: "대화 후 상황 악화",
  DIFFICULT_TO_DISCUSS: "직접 대화하기 어려움",
  URGENT_CONTACT: "긴급 연락 요청",
  RELOCATION_EXIT_CONSULT: "거주 대안 상담 요청",
  PAIRED_MISMATCH: "동일 매칭 응답 차이",
  CONSECUTIVE_NON_RESPONSE: "2주 연속 미응답",
};

export function riskReasonLabel(value: string): string {
  if (riskReasonLabels[value]) return riskReasonLabels[value];
  if (value.startsWith("REPEATED_")) return "같은 세부 불편이 반복됨";
  return value.replaceAll("_", " ");
}

export function formatKoreanDateTime(value: string | undefined): string {
  if (!value) return "기록 없음";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function shortId(value: string): string {
  return value.length > 15 ? `${value.slice(0, 7)}…${value.slice(-6)}` : value;
}
