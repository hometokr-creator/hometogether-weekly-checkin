import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyCallback: vi.fn(),
  persist: vi.fn(),
  configuration: vi.fn(),
}));

vi.mock("@/lib/messaging", () => ({
  createMessagingProvider: () => ({ verifyCallback: mocks.verifyCallback }),
}));
vi.mock("@/lib/messaging/config", () => ({
  getMessagingConfigurationStatus: mocks.configuration,
}));
vi.mock("@/lib/messaging/delivery-receipts", () => ({
  persistMessageDeliveryReceipt: mocks.persist,
}));

import { POST } from "@/app/api/webhooks/alimtalk/[provider]/route";

function request(body = "{}") {
  return new Request("https://hometogether.test/api/webhooks/alimtalk/kakao", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alimtalk-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-alimtalk-signature": `sha256=${"a".repeat(64)}`,
    },
    body,
  });
}

beforeEach(() => {
  mocks.verifyCallback.mockReset();
  mocks.persist.mockReset();
  mocks.configuration.mockReset();
  mocks.configuration.mockReturnValue({
    provider: "kakao",
    callbackConfigured: true,
    readyForAdminTest: true,
  });
});

describe("Alimtalk callback route", () => {
  it("rejects an invalid signature without writing a receipt", async () => {
    mocks.verifyCallback.mockResolvedValue({
      valid: false,
      errorCode: "INVALID_CALLBACK_SIGNATURE",
    });
    const response = await POST(request(), {
      params: Promise.resolve({ provider: "kakao" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("does not expose a callback route when callback readiness is incomplete", async () => {
    mocks.configuration.mockReturnValue({
      provider: "kakao",
      callbackConfigured: false,
      readyForAdminTest: false,
    });
    const response = await POST(request(), {
      params: Promise.resolve({ provider: "kakao" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.verifyCallback).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate verified event idempotently", async () => {
    mocks.verifyCallback.mockResolvedValue({
      valid: true,
      providerEventId: "event-fixture-0001",
      providerMessageId: "message-fixture-0001",
      status: "DELIVERED",
    });
    mocks.persist.mockResolvedValue({
      duplicate: true,
      matched: true,
      status: "DELIVERED",
    });
    const response = await POST(request(JSON.stringify({ fixture: true })), {
      params: Promise.resolve({ provider: "kakao" }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      matched: true,
      status: "DELIVERED",
    });
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it("caps the actual streamed body before verification", async () => {
    const response = await POST(request("x".repeat(64 * 1024 + 1)), {
      params: Promise.resolve({ provider: "kakao" }),
    });
    expect(response.status).toBe(413);
    expect(mocks.verifyCallback).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
