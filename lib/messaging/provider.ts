export interface WeeklyCheckinMessageInput {
  recipientId: string;
  phone: string;
  name: string;
  counterpartLabel: string;
  period: string;
  deadline: string;
  checkinUrl: string;
  idempotencyKey: string;
}

export interface MessagingResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface MessagingProvider {
  sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult>;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
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
    .replace(/\b\d{2,3}-?\d{3,4}-?\d{4}\b/g, "[PHONE_REDACTED]")
    .slice(0, 300);
}
