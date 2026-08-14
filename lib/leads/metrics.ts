import type {
  LeadRecord,
  LeadSlaStatus,
  LeadStatus,
  LeadViewingEvent,
} from "@/lib/leads/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function durationMinutes(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const value = (new Date(end).getTime() - new Date(start).getTime()) / MINUTE;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function earliestViewingEvent(lead: LeadRecord): LeadViewingEvent | undefined {
  return [...lead.viewingEvents].sort((left, right) =>
    left.requestedAt.localeCompare(right.requestedAt),
  )[0];
}

export function firstResponseMinutes(lead: LeadRecord): number | undefined {
  return durationMinutes(lead.createdAt, lead.firstResponseAt);
}

export function inquiryToViewingRequestMinutes(
  lead: LeadRecord,
): number | undefined {
  return durationMinutes(
    lead.createdAt,
    earliestViewingEvent(lead)?.requestedAt,
  );
}

export function viewingRequestToConfirmationMinutes(
  lead: LeadRecord,
): number | undefined {
  const viewing = earliestViewingEvent(lead);
  return durationMinutes(viewing?.requestedAt, viewing?.confirmedAt);
}

export function confirmationToViewingMinutes(
  lead: LeadRecord,
): number | undefined {
  const viewing = earliestViewingEvent(lead);
  return durationMinutes(viewing?.confirmedAt, viewing?.viewingAt);
}

export function totalLeadToRegistrationHours(
  lead: LeadRecord,
): number | undefined {
  if (lead.outcome.outcome !== "REGISTERED") return undefined;
  const minutes = durationMinutes(lead.createdAt, lead.outcome.closedAt);
  return minutes === undefined ? undefined : minutes / 60;
}

export function leadSlaStatus(
  lead: LeadRecord,
  now = new Date(),
): LeadSlaStatus {
  if (lead.firstResponseAt) return "RESPONDED";
  if (["REGISTERED", "CHURNED"].includes(lead.status)) return "ON_TRACK";
  const elapsed = now.getTime() - new Date(lead.createdAt).getTime();
  if (elapsed >= 15 * MINUTE) return "ESCALATED";
  if (elapsed >= 10 * MINUTE) return "BREACHED";
  if (elapsed >= 7 * MINUTE) return "WARNING";
  return "ON_TRACK";
}

export function nextLeadAction(lead: LeadRecord, now = new Date()): string {
  if (
    !lead.firstResponseAt &&
    !["REGISTERED", "CHURNED"].includes(lead.status)
  ) {
    return leadSlaStatus(lead, now) === "ON_TRACK"
      ? "첫 응답 보내기"
      : "즉시 첫 응답";
  }
  if (lead.status === "CONTACTED") return "방문 가능 시간 제안";
  if (lead.status === "VIEWING_REQUESTED") return "방문 확정";
  if (lead.status === "VIEWING_CONFIRMED") return "방문 결과 기록";
  if (lead.status === "VIEWED") return "등록 또는 이탈 사유 기록";
  return lead.status === "REGISTERED" ? "등록 완료" : "이탈 사유 확인";
}

export function isViewingRequested(lead: LeadRecord): boolean {
  return (
    lead.viewingEvents.length > 0 ||
    lead.status === "VIEWING_REQUESTED" ||
    lead.status === "VIEWING_CONFIRMED" ||
    lead.status === "VIEWED" ||
    lead.status === "REGISTERED"
  );
}

export function isViewingConfirmed(lead: LeadRecord): boolean {
  return (
    lead.viewingEvents.some((item) => Boolean(item.confirmedAt)) ||
    ["VIEWING_CONFIRMED", "VIEWED", "REGISTERED"].includes(lead.status)
  );
}

export function isViewed(lead: LeadRecord): boolean {
  return (
    lead.viewingEvents.some((item) => Boolean(item.viewingAt)) ||
    ["VIEWED", "REGISTERED"].includes(lead.status)
  );
}

export function stageReached(lead: LeadRecord, stage: LeadStatus): boolean {
  const order: LeadStatus[] = [
    "NEW",
    "CONTACTED",
    "VIEWING_REQUESTED",
    "VIEWING_CONFIRMED",
    "VIEWED",
    "REGISTERED",
  ];
  if (stage === "CHURNED") return lead.status === "CHURNED";
  return order.indexOf(lead.status) >= order.indexOf(stage);
}

export function formatMinutes(minutes?: number): string {
  if (minutes === undefined) return "미응답";
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${Math.round(minutes)}분`;
  return `${Math.floor(minutes / 60)}시간 ${Math.round(minutes % 60)}분`;
}

export function isSlaCompliant(lead: LeadRecord): boolean | undefined {
  const minutes = firstResponseMinutes(lead);
  return minutes === undefined ? undefined : minutes <= 10;
}

export function isCreatedBetween(
  lead: LeadRecord,
  from?: string,
  to?: string,
): boolean {
  const createdDate = lead.createdAt.slice(0, 10);
  return (!from || createdDate >= from) && (!to || createdDate <= to);
}

export const milliseconds = { MINUTE, HOUR };
