import { z } from "zod";

export type ProviderFailureClass = "TRANSIENT" | "PERMANENT" | "UNKNOWN";

export const weeklyCheckinTemplateVariablesSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    counterpartLabel: z.enum(["학생분", "집주인분", "공동생활 상대방"]),
    period: z.string().trim().min(1).max(80),
    deadline: z.string().trim().min(1).max(80),
    checkinUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", "체크인 URL은 HTTPS여야 합니다."),
  })
  .strict();

export type WeeklyCheckinTemplateVariables = z.infer<
  typeof weeklyCheckinTemplateVariablesSchema
>;

export interface WeeklyCheckinMessageInput extends WeeklyCheckinTemplateVariables {
  recipientId: string;
  phone: string;
  idempotencyKey: string;
  templateCode?: string;
}

export interface MessagingResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  failureClass?: ProviderFailureClass;
  retryAfterSeconds?: number;
}

export interface MessagingStatusInput {
  idempotencyKey: string;
  providerMessageId?: string;
}

export interface MessagingStatusResult extends MessagingResult {
  status: "PENDING" | "DELIVERED" | "FAILED" | "UNKNOWN";
}

export interface MessagingCallbackInput {
  rawBody: string;
  headers: Headers;
}

export interface MessagingCallbackResult {
  valid: boolean;
  providerMessageId?: string;
  status?: "PENDING" | "DELIVERED" | "FAILED" | "UNKNOWN";
  errorCode?: string;
}

export interface MessagingProvider {
  sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult>;
  getStatus(input: MessagingStatusInput): Promise<MessagingStatusResult>;
  verifyCallback(input: MessagingCallbackInput): Promise<MessagingCallbackResult>;
}

export function normalizeKoreanMobilePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (/^010\d{8}$/.test(digits)) return `+82${digits.slice(1)}`;
  if (/^8210\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

export function validateWeeklyCheckinMessageInput(
  input: WeeklyCheckinMessageInput,
): { success: true; variables: WeeklyCheckinTemplateVariables; phone: string } | {
  success: false;
  error: string;
} {
  const phone = normalizeKoreanMobilePhone(input.phone);
  if (!phone) return { success: false, error: "INVALID_RECIPIENT_PHONE" };
  const parsed = weeklyCheckinTemplateVariablesSchema.safeParse({
    name: input.name,
    counterpartLabel: input.counterpartLabel,
    period: input.period,
    deadline: input.deadline,
    checkinUrl: input.checkinUrl,
  });
  if (!parsed.success) {
    return { success: false, error: "INVALID_TEMPLATE_VARIABLES" };
  }
  return { success: true, variables: parsed.data, phone };
}

export function classifyHttpFailure(status: number): ProviderFailureClass {
  return status === 408 || status === 425 || status === 429 || status >= 500
    ? "TRANSIENT"
    : "PERMANENT";
}

export function retryDelayMs(
  attemptCount: number,
  retryAfterSeconds?: number,
): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.min(Math.max(retryAfterSeconds, 60), 24 * 60 * 60) * 1000;
  }
  const delays = [10, 30, 120, 480] as const;
  const minutes = delays[Math.min(Math.max(attemptCount - 1, 0), delays.length - 1)];
  return minutes * 60 * 1000;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  if (/^8210\d{8}$/.test(digits)) return `010-****-${digits.slice(-4)}`;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export function renderWeeklyCheckinMessage(input: WeeklyCheckinMessageInput): string {
  return `[홈투게더 공동생활 주간 체크인]

안녕하세요, ${input.name}님.
이번 주도 ${input.counterpartLabel}과 잘 지내고 계신가요?

홈투게더에서 ${input.period} 동안의 공동생활 상태를 확인하고 있습니다.
아래 버튼을 통해 간단한 주간 체크인을 완료해 주세요.

불편한 점이 없다면 약 20초,
불편한 점이 있다면 약 1분 정도 소요됩니다.

응답 내용은 홈투게더 운영팀이 먼저 확인하며,
함께 거주하는 상대방에게 자동으로 전달되지 않습니다.

응답 기한: ${input.deadline}`;
}

export function sanitizeProviderError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/(authorization|api[-_ ]?key|sender[-_ ]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/\/checkin\/[A-Za-z0-9_-]{8,128}/g, "/checkin/[TOKEN_REDACTED]")
    .replace(/\+[1-9][0-9]{7,14}/g, "[PHONE_REDACTED]")
    .replace(/\b\d{2,3}-?\d{3,4}-?\d{4}\b/g, "[PHONE_REDACTED]")
    .slice(0, 300);
}
