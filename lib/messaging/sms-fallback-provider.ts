import {
  renderWeeklyCheckinMessage,
  sanitizeProviderError,
  type MessagingProvider,
  type MessagingResult,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

export interface SmsConfig {
  baseUrl: string;
  apiKey: string;
}

class GenericSmsProvider implements MessagingProvider {
  constructor(private readonly config: SmsConfig) {}

  async sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult> {
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/messages/sms`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "idempotency-key": `${input.idempotencyKey}:sms`,
        },
        body: JSON.stringify({
          recipient: input.phone,
          content: `${renderWeeklyCheckinMessage(input)}\n\n주간 체크인: ${input.checkinUrl}`,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return response.ok
        ? { success: true, providerMessageId: String(body.messageId ?? body.id ?? "sms") }
        : {
            success: false,
            errorCode: String(body.code ?? `SMS_HTTP_${response.status}`),
            errorMessage: sanitizeProviderError(body.message ?? response.statusText),
          };
    } catch (error) {
      return {
        success: false,
        errorCode: "SMS_NETWORK_ERROR",
        errorMessage: sanitizeProviderError(error),
      };
    }
  }
}

export class SmsFallbackMessagingProvider implements MessagingProvider {
  private readonly sms: GenericSmsProvider;

  constructor(
    private readonly primary: MessagingProvider,
    smsConfig: SmsConfig,
  ) {
    this.sms = new GenericSmsProvider(smsConfig);
  }

  async sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult> {
    const result = await this.primary.sendWeeklyCheckin(input);
    // A timeout may mean the relay accepted the request. Do not create a
    // duplicate cross-channel notification while delivery is unknown.
    if (result.success || result.errorCode === "KAKAO_TIMEOUT_UNKNOWN") return result;
    return this.sms.sendWeeklyCheckin(input);
  }
}
