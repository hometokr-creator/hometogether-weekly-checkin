import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumePublicIpRateLimit: vi.fn(),
  consumeCheckinRateLimit: vi.fn(),
  getPublicCheckin: vi.fn(),
  assertPublicCheckinToken: vi.fn(),
  saveCheckinDraft: vi.fn(),
  submitCheckin: vi.fn(),
}));

vi.mock("@/lib/checkin/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkin/rate-limit")>();
  return {
    ...actual,
    consumePublicIpRateLimit: mocks.consumePublicIpRateLimit,
    consumeCheckinRateLimit: mocks.consumeCheckinRateLimit,
  };
});

vi.mock("@/lib/checkin/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/checkin/service")>();
  return {
    ...actual,
    getPublicCheckin: mocks.getPublicCheckin,
    assertPublicCheckinToken: mocks.assertPublicCheckinToken,
    saveCheckinDraft: mocks.saveCheckinDraft,
    submitCheckin: mocks.submitCheckin,
  };
});

const formattedUnknownToken = "A".repeat(43);

describe("public check-in API rate-limit ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumePublicIpRateLimit.mockResolvedValue(true);
    mocks.consumeCheckinRateLimit.mockResolvedValue(true);
    mocks.getPublicCheckin.mockRejectedValue(new Error("unknown token"));
    mocks.assertPublicCheckinToken.mockRejectedValue(new Error("unknown token"));
  });

  it("does not create a token-specific bucket for an unknown GET token", async () => {
    const { GET } = await import("@/app/api/checkins/[token]/route");
    const response = await GET(
      new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}`),
      { params: Promise.resolve({ token: formattedUnknownToken }) },
    );

    expect(response.status).toBe(500);
    expect(mocks.consumePublicIpRateLimit).toHaveBeenCalledOnce();
    expect(mocks.getPublicCheckin).toHaveBeenCalledOnce();
    expect(mocks.consumeCheckinRateLimit).not.toHaveBeenCalled();
  });

  it("rate-limits a malformed GET token before returning 404", async () => {
    const { GET } = await import("@/app/api/checkins/[token]/route");
    const response = await GET(
      new Request("https://checkin.example/api/checkins/bad", {
        headers: { "x-real-ip": "203.0.113.20" },
      }),
      { params: Promise.resolve({ token: "bad" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.consumePublicIpRateLimit).toHaveBeenCalledOnce();
    expect(mocks.getPublicCheckin).not.toHaveBeenCalled();
    expect(mocks.consumeCheckinRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 before a malformed GET token reaches service code", async () => {
    mocks.consumePublicIpRateLimit.mockResolvedValue(false);
    const { GET } = await import("@/app/api/checkins/[token]/route");
    const response = await GET(
      new Request("https://checkin.example/api/checkins/bad"),
      { params: Promise.resolve({ token: "bad" }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.getPublicCheckin).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", async () => {
      const { PATCH } = await import("@/app/api/checkins/[token]/draft/route");
      return PATCH(
        new Request("https://checkin.example/api/checkins/bad/draft", {
          method: "PATCH",
          body: JSON.stringify({ answers: {} }),
        }),
        { params: Promise.resolve({ token: "bad" }) },
      );
    }],
    ["submit", async () => {
      const { POST } = await import("@/app/api/checkins/[token]/submit/route");
      return POST(
        new Request("https://checkin.example/api/checkins/bad/submit", {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ token: "bad" }) },
      );
    }],
  ])("rate-limits a malformed %s token before returning 404", async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(404);
    expect(mocks.consumePublicIpRateLimit).toHaveBeenCalledOnce();
    expect(mocks.assertPublicCheckinToken).not.toHaveBeenCalled();
    expect(mocks.consumeCheckinRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", async () => {
      const { PATCH } = await import("@/app/api/checkins/[token]/draft/route");
      return PATCH(
        new Request("https://checkin.example/api/checkins/bad/draft", {
          method: "PATCH",
          headers: { "content-length": "64001" },
          body: "{}",
        }),
        { params: Promise.resolve({ token: "bad" }) },
      );
    }],
    ["submit", async () => {
      const { POST } = await import("@/app/api/checkins/[token]/submit/route");
      return POST(
        new Request("https://checkin.example/api/checkins/bad/submit", {
          method: "POST",
          headers: { "content-length": "256001" },
          body: "{}",
        }),
        { params: Promise.resolve({ token: "bad" }) },
      );
    }],
  ])("rejects declared oversized %s bodies before any database limiter", async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(413);
    expect(mocks.consumePublicIpRateLimit).not.toHaveBeenCalled();
    expect(mocks.assertPublicCheckinToken).not.toHaveBeenCalled();
    expect(mocks.consumeCheckinRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", async () => {
      const { PATCH } = await import("@/app/api/checkins/[token]/draft/route");
      return PATCH(
        new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}/draft`, {
          method: "PATCH",
          body: "{}",
        }),
        { params: Promise.resolve({ token: formattedUnknownToken }) },
      );
    }],
    ["submit", async () => {
      const { POST } = await import("@/app/api/checkins/[token]/submit/route");
      return POST(
        new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}/submit`, {
          method: "POST",
          body: "{}",
        }),
        { params: Promise.resolve({ token: formattedUnknownToken }) },
      );
    }],
  ])("validates an unknown %s token before its token-specific bucket", async (_name, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(500);
    expect(mocks.consumePublicIpRateLimit).toHaveBeenCalledOnce();
    expect(mocks.assertPublicCheckinToken).toHaveBeenCalledOnce();
    expect(mocks.consumeCheckinRateLimit).not.toHaveBeenCalled();
    expect(mocks.saveCheckinDraft).not.toHaveBeenCalled();
    expect(mocks.submitCheckin).not.toHaveBeenCalled();
  });

  it("preserves normal GET, draft, and submit flows after both limits pass", async () => {
    mocks.getPublicCheckin.mockResolvedValue({ id: "invitation-1" });
    mocks.assertPublicCheckinToken.mockResolvedValue(undefined);
    mocks.saveCheckinDraft.mockResolvedValue({ status: "OPENED" });
    mocks.submitCheckin.mockResolvedValue({ responseId: "response-1" });

    const [{ GET }, { PATCH }, { POST }] = await Promise.all([
      import("@/app/api/checkins/[token]/route"),
      import("@/app/api/checkins/[token]/draft/route"),
      import("@/app/api/checkins/[token]/submit/route"),
    ]);
    const params = { params: Promise.resolve({ token: formattedUnknownToken }) };
    const getResponse = await GET(
      new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}`),
      params,
    );
    const draftResponse = await PATCH(
      new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}/draft`, {
        method: "PATCH",
        body: JSON.stringify({ answers: { step: "OVERALL" } }),
      }),
      params,
    );
    const submitResponse = await POST(
      new Request(`https://checkin.example/api/checkins/${formattedUnknownToken}/submit`, {
        method: "POST",
        body: "{}",
      }),
      params,
    );

    expect([getResponse.status, draftResponse.status, submitResponse.status]).toEqual([
      200, 200, 200,
    ]);
    expect(mocks.consumePublicIpRateLimit).toHaveBeenCalledTimes(3);
    expect(mocks.consumeCheckinRateLimit).toHaveBeenCalledTimes(3);
    expect(mocks.saveCheckinDraft).toHaveBeenCalledOnce();
    expect(mocks.submitCheckin).toHaveBeenCalledOnce();
  });
});
