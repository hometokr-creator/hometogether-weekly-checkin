import {
  renderWeeklyCheckinMessage,
  sanitizeProviderError,
  type MessagingProvider,
  type MessagingResult,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

export interface KakaoAlimtalkConfig {
  baseUrl: string;
  apiKey: string;
  senderKey: string;
  templateCode: string;
  timeoutMs?: number;
}

/**
 * Relay-neutral Alimtalk adapter. Adjust only this payload/response mapping when
 * a relay vendor is selected; domain code remains coupled to MessagingProvider.
 */
export class KakaoAlimtalkProvider implements MessagingProvider {
  constructor(private readonly config: KakaoAlimtalkConfig) {}

  async sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8_000);

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/messages/alimtalk`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          senderKey: this.config.senderKey,
          templateCode: this.config.templateCode,
          recipient: input.phone,
          variables: {
            name: input.name,
            counterpartLabel: input.counterpartLabel,
            period: input.period,
            deadline: input.deadline,
            checkinUrl: input.checkinUrl,
          },
          content: renderWeeklyCheckinMessage(input),
          buttons: [
            {
              name: "주간 체크인 하기",
              type: "WL",
              urlMobile: input.checkinUrl,
              urlPc: input.checkinUrl,
            },
          ],
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return {
          success: false,
          errorCode: String(body.code ?? `HTTP_${response.status}`),
          errorMessage: sanitizeProviderError(body.message ?? response.statusText),
        };
      }

      return {
        success: true,
        providerMessageId: String(body.messageId ?? body.id ?? input.idempotencyKey),
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        success: false,
        errorCode: timedOut ? "KAKAO_TIMEOUT_UNKNOWN" : "KAKAO_NETWORK_ERROR",
        errorMessage: sanitizeProviderError(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
