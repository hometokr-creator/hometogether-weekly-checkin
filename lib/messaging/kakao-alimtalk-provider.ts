import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import {
  classifyHttpFailure,
  renderWeeklyCheckinMessage,
  sanitizeProviderError,
  validateWeeklyCheckinMessageInput,
  type MessagingCallbackInput,
  type MessagingCallbackResult,
  type MessagingProvider,
  type MessagingResult,
  type MessagingStatusInput,
  type MessagingStatusResult,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

export interface KakaoAlimtalkConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  senderProfile: string;
  templateCode: string;
  callbackSecret?: string;
  timeoutMs?: number;
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

export function normalizeProviderDeliveryStatus(
  value: unknown,
): MessagingStatusResult["status"] {
  const status = String(value ?? "").toUpperCase();
  if (["DELIVERED", "SUCCESS"].includes(status)) return "DELIVERED";
  if (["SENT", "SUBMITTED"].includes(status)) return "SENT";
  if (["ACCEPTED", "PROCESSING", "QUEUED", "PENDING"].includes(status)) {
    return "ACCEPTED";
  }
  if (["FAILED", "REJECTED", "CANCELLED"].includes(status)) return "FAILED";
  return "UNKNOWN";
}

const callbackBodySchema = z.object({
  eventId: z.string().trim().min(8).max(160),
  messageId: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(80),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  errorCode: z.string().trim().max(80).optional(),
}).strict();

const CALLBACK_MAX_AGE_SECONDS = 5 * 60;

/**
 * Relay-neutral Alimtalk adapter. Adjust only this payload/response mapping when
 * a relay vendor is selected; domain code remains coupled to MessagingProvider.
 */
export class KakaoAlimtalkProvider implements MessagingProvider {
  constructor(private readonly config: KakaoAlimtalkConfig) {}

  async sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult> {
    const validated = validateWeeklyCheckinMessageInput(input);
    if (!validated.success) {
      return {
        success: false,
        errorCode: validated.error,
        errorMessage: "알림톡 수신자 또는 템플릿 변수가 올바르지 않습니다.",
        failureClass: "PERMANENT",
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8_000);

    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/messages/alimtalk`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "x-api-secret": this.config.apiSecret,
          "idempotency-key": input.idempotencyKey,
        },
        body: JSON.stringify({
          senderProfile: this.config.senderProfile,
          templateCode: input.templateCode ?? this.config.templateCode,
          recipient: validated.phone,
          variables: validated.variables,
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
          failureClass: classifyHttpFailure(response.status),
          retryAfterSeconds: retryAfterSeconds(response),
        };
      }

      return {
        success: true,
        providerMessageId:
          body.messageId || body.id ? String(body.messageId ?? body.id) : undefined,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        success: false,
        errorCode: timedOut ? "KAKAO_TIMEOUT_UNKNOWN" : "KAKAO_NETWORK_ERROR",
        errorMessage: sanitizeProviderError(error),
        failureClass: timedOut ? "UNKNOWN" : "TRANSIENT",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus(input: MessagingStatusInput): Promise<MessagingStatusResult> {
    const reference = input.providerMessageId ?? input.idempotencyKey;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 8_000);
    try {
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/messages/alimtalk/${encodeURIComponent(reference)}`,
        {
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "x-api-secret": this.config.apiSecret,
          },
          signal: controller.signal,
        },
      );
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return {
          success: false,
          status: "UNKNOWN",
          errorCode: String(body.code ?? `HTTP_${response.status}`),
          errorMessage: sanitizeProviderError(body.message ?? response.statusText),
          failureClass: classifyHttpFailure(response.status),
          retryAfterSeconds: retryAfterSeconds(response),
        };
      }
      const status = normalizeProviderDeliveryStatus(body.status);
      return {
        success: status === "DELIVERED",
        status,
        providerMessageId:
          body.messageId || body.id ? String(body.messageId ?? body.id) : input.providerMessageId,
        failureClass: status === "FAILED" ? "PERMANENT" : undefined,
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        success: false,
        status: "UNKNOWN",
        errorCode: timedOut ? "KAKAO_STATUS_TIMEOUT" : "KAKAO_STATUS_NETWORK_ERROR",
        errorMessage: sanitizeProviderError(error),
        failureClass: timedOut ? "UNKNOWN" : "TRANSIENT",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async verifyCallback(input: MessagingCallbackInput): Promise<MessagingCallbackResult> {
    if (!this.config.callbackSecret) {
      return { valid: false, errorCode: "CALLBACK_SECRET_MISSING" };
    }
    const timestamp = input.headers.get("x-alimtalk-timestamp") ?? "";
    const supplied = input.headers.get("x-alimtalk-signature") ?? "";
    if (!/^\d{10}$/.test(timestamp)) {
      return { valid: false, errorCode: "INVALID_CALLBACK_TIMESTAMP" };
    }
    const timestampSeconds = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
        CALLBACK_MAX_AGE_SECONDS
    ) {
      return { valid: false, errorCode: "STALE_CALLBACK_TIMESTAMP" };
    }
    const expected = `sha256=${createHmac("sha256", this.config.callbackSecret)
      .update(`${timestamp}.${input.rawBody}`)
      .digest("hex")}`;
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return { valid: false, errorCode: "INVALID_CALLBACK_SIGNATURE" };
    }
    try {
      const parsed = callbackBodySchema.safeParse(JSON.parse(input.rawBody));
      if (!parsed.success) {
        return { valid: false, errorCode: "INVALID_CALLBACK_BODY" };
      }
      const headerEventId = input.headers.get("x-alimtalk-event-id");
      if (headerEventId && headerEventId !== parsed.data.eventId) {
        return { valid: false, errorCode: "CALLBACK_EVENT_ID_MISMATCH" };
      }
      return {
        valid: true,
        providerEventId: parsed.data.eventId,
        providerMessageId: parsed.data.messageId,
        status: normalizeProviderDeliveryStatus(parsed.data.status),
        occurredAt: parsed.data.occurredAt,
        errorCode: parsed.data.errorCode,
      };
    } catch {
      return { valid: false, errorCode: "INVALID_CALLBACK_BODY" };
    }
  }
}
