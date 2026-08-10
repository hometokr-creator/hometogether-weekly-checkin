import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import {
  KakaoAlimtalkProvider,
  normalizeProviderDeliveryStatus,
} from "@/lib/messaging/kakao-alimtalk-provider";
import {
  classifyHttpFailure,
  maskPhone,
  normalizeKoreanMobilePhone,
  renderWeeklyCheckinMessage,
  retryDelayMs,
  sanitizeProviderError,
  validateWeeklyCheckinMessageInput,
  weeklyCheckinTemplateVariablesSchema,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

const input = {
  recipientId: "participant-1",
  phone: "+821012345678",
  name: "정인",
  counterpartLabel: "학생분",
  period: "7월 27일~8월 2일",
  deadline: "8월 5일 자정",
  checkinUrl: "https://example.test/checkin/opaque",
  idempotencyKey: "weekly:run:participant:match:initial",
} satisfies WeeklyCheckinMessageInput;

describe("messaging", () => {
  it("masks phone numbers", () => {
    expect(maskPhone(input.phone)).toBe("010-****-5678");
  });

  it("renders the approved privacy-safe template", () => {
    const body = renderWeeklyCheckinMessage(input);
    expect(body).toContain("학생분과 잘 지내고 계신가요?");
    expect(body).not.toContain(input.phone);
    expect(body).not.toMatch(/상세주소|학교명|계약금액|불편사항:/);
  });

  it("uses the mock provider without exposing the full phone", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await new MockMessagingProvider().sendWeeklyCheckin(input);

    expect(result.success).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.phone);
    log.mockRestore();
  });

  it("normalizes only Korean mobile recipients", () => {
    expect(normalizeKoreanMobilePhone("010-1234-5678")).toBe("+821012345678");
    expect(normalizeKoreanMobilePhone("+82 10 1234 5678")).toBe("+821012345678");
    expect(normalizeKoreanMobilePhone("02-123-4567")).toBeNull();
  });

  it("strictly validates template keys and HTTPS links", () => {
    expect(validateWeeklyCheckinMessageInput(input)).toMatchObject({ success: true });
    expect(
      weeklyCheckinTemplateVariablesSchema.safeParse({
        name: "관리자",
        counterpartLabel: "공동생활 상대방",
        period: "이번 주",
        deadline: "수요일",
        checkinUrl: "http://example.test/checkin/token",
      }).success,
    ).toBe(false);
    expect(
      weeklyCheckinTemplateVariablesSchema.safeParse({
        name: "관리자",
        counterpartLabel: "공동생활 상대방",
        period: "이번 주",
        deadline: "수요일",
        checkinUrl: "https://example.test/checkin/token",
        unexpected: "blocked",
      }).success,
    ).toBe(false);
  });

  it("redacts local and E.164 phone numbers from provider errors", () => {
    const safe = sanitizeProviderError(
      "recipient=+821012345678 fallback=010-9876-5432 api_key=secret-value",
    );
    expect(safe).not.toMatch(/821012345678|010-9876-5432|secret-value/);
    expect(safe.match(/\[PHONE_REDACTED\]/g)).toHaveLength(2);
  });

  it("redacts bearer check-in tokens from provider errors", () => {
    const safe = sanitizeProviderError(
      "provider rejected https://hometogether.test/checkin/opaqueBearerToken_123456789",
    );
    expect(safe).toContain("/checkin/[TOKEN_REDACTED]");
    expect(safe).not.toContain("opaqueBearerToken_123456789");
  });

  it("classifies transient HTTP failures and uses bounded exponential backoff", () => {
    expect(classifyHttpFailure(429)).toBe("TRANSIENT");
    expect(classifyHttpFailure(503)).toBe("TRANSIENT");
    expect(classifyHttpFailure(400)).toBe("PERMANENT");
    expect(retryDelayMs(1)).toBe(10 * 60 * 1000);
    expect(retryDelayMs(4)).toBe(8 * 60 * 60 * 1000);
    expect(retryDelayMs(5)).toBe(8 * 60 * 60 * 1000);
    expect(retryDelayMs(1, 120)).toBe(120 * 1000);
  });

  it("normalizes provider lifecycle states without treating acceptance as delivery", () => {
    expect(normalizeProviderDeliveryStatus("accepted")).toBe("ACCEPTED");
    expect(normalizeProviderDeliveryStatus("sent")).toBe("SENT");
    expect(normalizeProviderDeliveryStatus("success")).toBe("DELIVERED");
    expect(normalizeProviderDeliveryStatus("failed")).toBe("FAILED");
    expect(normalizeProviderDeliveryStatus("unexpected")).toBe("UNKNOWN");
  });

  it("verifies timestamp-bound callbacks and returns idempotency metadata", async () => {
    const callbackSecret = "fixture-callback-secret-32-bytes-long";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({
      eventId: "event-fixture-0001",
      messageId: "provider-message-1",
      status: "delivered",
      occurredAt: "2026-08-09T09:00:00+09:00",
    });
    const signature = `sha256=${createHmac("sha256", callbackSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")}`;
    const provider = new KakaoAlimtalkProvider({
      baseUrl: "https://relay.example.test",
      apiKey: "fixture-key",
      apiSecret: "fixture-secret",
      senderProfile: "fixture-sender",
      templateCode: "fixture-template",
      callbackSecret,
    });
    const result = await provider.verifyCallback({
      rawBody,
      headers: new Headers({
        "x-alimtalk-timestamp": timestamp,
        "x-alimtalk-signature": signature,
        "x-alimtalk-event-id": "event-fixture-0001",
      }),
    });
    expect(result).toMatchObject({
      valid: true,
      providerEventId: "event-fixture-0001",
      providerMessageId: "provider-message-1",
      status: "DELIVERED",
    });
  });

  it("rejects a correctly signed callback outside the replay window", async () => {
    const callbackSecret = "fixture-callback-secret-32-bytes-long";
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const rawBody = JSON.stringify({
      eventId: "event-fixture-0002",
      messageId: "provider-message-2",
      status: "delivered",
    });
    const signature = `sha256=${createHmac("sha256", callbackSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex")}`;
    const provider = new KakaoAlimtalkProvider({
      baseUrl: "https://relay.example.test",
      apiKey: "fixture-key",
      apiSecret: "fixture-secret",
      senderProfile: "fixture-sender",
      templateCode: "fixture-template",
      callbackSecret,
    });
    await expect(provider.verifyCallback({
      rawBody,
      headers: new Headers({
        "x-alimtalk-timestamp": timestamp,
        "x-alimtalk-signature": signature,
      }),
    })).resolves.toMatchObject({
      valid: false,
      errorCode: "STALE_CALLBACK_TIMESTAMP",
    });
  });

  it("rejects a callback body that differs from the signed bytes", async () => {
    const callbackSecret = "fixture-callback-secret-32-bytes-long";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signedBody = JSON.stringify({
      eventId: "event-fixture-0003",
      messageId: "provider-message-3",
      status: "accepted",
    });
    const alteredBody = JSON.stringify({
      eventId: "event-fixture-0003",
      messageId: "provider-message-3",
      status: "delivered",
    });
    const signature = `sha256=${createHmac("sha256", callbackSecret)
      .update(`${timestamp}.${signedBody}`)
      .digest("hex")}`;
    const provider = new KakaoAlimtalkProvider({
      baseUrl: "https://relay.example.test",
      apiKey: "fixture-key",
      apiSecret: "fixture-secret",
      senderProfile: "fixture-sender",
      templateCode: "fixture-template",
      callbackSecret,
    });

    await expect(provider.verifyCallback({
      rawBody: alteredBody,
      headers: new Headers({
        "x-alimtalk-timestamp": timestamp,
        "x-alimtalk-signature": signature,
      }),
    })).resolves.toMatchObject({
      valid: false,
      errorCode: "INVALID_CALLBACK_SIGNATURE",
    });
  });
});
