import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckinRepository, DispatchCandidate } from "@/lib/checkin/repository";
import { createWeeklyCheckins } from "@/lib/jobs/create-weekly-checkins";
import { dispatchMessageOutbox } from "@/lib/jobs/dispatch-message-outbox";
import type { MessagingProvider } from "@/lib/messaging/provider";

const originalSendingEnabled = process.env.CHECKIN_SENDING_ENABLED;
const originalApiKey = process.env.ALIMTALK_API_KEY;

afterEach(() => {
  process.env.CHECKIN_SENDING_ENABLED = originalSendingEnabled;
  process.env.ALIMTALK_API_KEY = originalApiKey;
});

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    recipientId: "participant-1",
    recipientName: "응답자",
    phone: "+821012345678",
    counterpartLabel: "학생분",
    period: "8월 3일 ~ 8월 9일",
    deadline: "8월 12일 오후 11:59",
    rawToken: "opaque-token",
    idempotencyKey: "weekly:run:participant:match:initial",
    messageLogId: "message-1",
    deliveryLeaseOwner: "lease-owner-1",
    messageType: "WEEKLY_CHECKIN",
    deliveryScope: "PRODUCTION",
    attemptCount: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function repositoryWithClaims(claims: DispatchCandidate[]) {
  return {
    enqueueWeeklyMessages: vi.fn(async () => ({ queued: claims.length, dataQualityCount: 0 })),
    claimMessageDeliveries: vi.fn(async () => claims),
    saveMessageTemplate: vi.fn(async () => undefined),
    recordMessageResult: vi.fn(async () => undefined),
  } as unknown as CheckinRepository;
}

function provider(overrides: Partial<MessagingProvider> = {}): MessagingProvider {
  return {
    sendWeeklyCheckin: vi.fn(async () => ({ success: true, providerMessageId: "provider-1" })),
    getStatus: vi.fn(async () => ({ success: false, status: "UNKNOWN" as const })),
    verifyCallback: vi.fn(async () => ({ valid: true })),
    ...overrides,
  };
}

describe("message outbox operations", () => {
  it("does not create invitations or messages while bulk sending is disabled", async () => {
    process.env.CHECKIN_SENDING_ENABLED = "false";
    const repository = repositoryWithClaims([]);
    const result = await createWeeklyCheckins({ repository });

    expect(result).toMatchObject({ created: 0, skipped: true, reason: "SENDING_DISABLED" });
    expect(repository.enqueueWeeklyMessages).not.toHaveBeenCalled();
  });

  it("fails closed before claiming when credentials are missing", async () => {
    delete process.env.ALIMTALK_API_KEY;
    const repository = repositoryWithClaims([candidate()]);
    const result = await dispatchMessageOutbox({ repository });

    expect(result).toMatchObject({ claimed: 0, blocked: true });
    expect(repository.claimMessageDeliveries).not.toHaveBeenCalled();
  });

  it("reconciles an unknown provider outcome before attempting another send", async () => {
    const unknown = candidate({ failureClass: "UNKNOWN", attemptCount: 2 });
    const repository = repositoryWithClaims([unknown]);
    const messaging = provider({
      getStatus: vi.fn(async () => ({ success: false, status: "ACCEPTED" as const })),
    });
    const result = await dispatchMessageOutbox({ repository, provider: messaging });

    expect(messaging.getStatus).toHaveBeenCalledOnce();
    expect(messaging.sendWeeklyCheckin).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, sent: 1, retry: 0, reconciled: 1 });
    expect(repository.recordMessageResult).toHaveBeenCalledWith(
      unknown,
      "WEEKLY_CHECKIN",
      "test-relay",
      expect.objectContaining({
        success: true,
        status: "ACCEPTED",
      }),
    );
  });

  it("reconciles a transient result carrying a provider ID without resending", async () => {
    const referenced = candidate({
      failureClass: "TRANSIENT",
      providerMessageId: "provider-already-accepted",
      attemptCount: 2,
    });
    const repository = repositoryWithClaims([referenced]);
    const messaging = provider({
      getStatus: vi.fn(async () => ({
        success: false,
        status: "SENT" as const,
        providerMessageId: "provider-already-accepted",
      })),
    });

    const result = await dispatchMessageOutbox({ repository, provider: messaging });

    expect(messaging.getStatus).toHaveBeenCalledOnce();
    expect(messaging.sendWeeklyCheckin).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, sent: 1, retry: 0, reconciled: 1 });
    expect(repository.recordMessageResult).toHaveBeenCalledWith(
      referenced,
      "WEEKLY_CHECKIN",
      "test-relay",
      expect.objectContaining({ success: true, status: "SENT" }),
    );
  });

  it("moves an unresolved unknown delivery to manual failure at the attempt limit", async () => {
    const unknown = candidate({ failureClass: "UNKNOWN", attemptCount: 5, maxAttempts: 5 });
    const repository = repositoryWithClaims([unknown]);
    const messaging = provider();
    const result = await dispatchMessageOutbox({ repository, provider: messaging });

    expect(result).toMatchObject({ failed: 1, retry: 0, reconciled: 1 });
    expect(repository.recordMessageResult).toHaveBeenCalledWith(
      unknown,
      "WEEKLY_CHECKIN",
      "test-relay",
      expect.objectContaining({
        errorCode: "DELIVERY_UNRESOLVED_MAX_ATTEMPTS",
        failureClass: "PERMANENT",
      }),
    );
  });

  it("builds the admin test URL only from PUBLIC_CHECKIN_BASE_URL", async () => {
    process.env.CHECKIN_SENDING_ENABLED = "false";
    const adminTest = candidate({
      rawToken: undefined,
      checkinUrl: "https://attacker.invalid/checkin",
      deliveryScope: "ADMIN_TEST",
      messageType: "ALIMTALK_TEST",
      counterpartLabel: "공동생활 상대방",
    });
    const repository = repositoryWithClaims([adminTest]);
    const messaging = provider();
    await dispatchMessageOutbox({ repository, provider: messaging });

    expect(messaging.sendWeeklyCheckin).toHaveBeenCalledWith(
      expect.objectContaining({
        checkinUrl: "https://hometogether.test/privacy/checkin",
      }),
    );
  });

  it("uses the bearer URL for delivery without persisting it as template metadata", async () => {
    const production = candidate({ rawToken: "opaque-production-token" });
    const repository = repositoryWithClaims([production]);
    const messaging = provider();

    await dispatchMessageOutbox({ repository, provider: messaging });

    expect(messaging.sendWeeklyCheckin).toHaveBeenCalledWith(
      expect.objectContaining({
        checkinUrl: "https://hometogether.test/checkin/opaque-production-token",
      }),
    );
    expect(repository.saveMessageTemplate).toHaveBeenCalledWith(
      production,
      "test-template",
      {
        name: "응답자",
        counterpartLabel: "학생분",
        period: "8월 3일 ~ 8월 9일",
        deadline: "8월 12일 오후 11:59",
      },
    );
    const persistedVariables = vi.mocked(repository.saveMessageTemplate).mock.calls[0]?.[2];
    expect(JSON.stringify(persistedVariables)).not.toContain("opaque-production-token");
    expect(persistedVariables).not.toHaveProperty("checkinUrl");
  });
});
