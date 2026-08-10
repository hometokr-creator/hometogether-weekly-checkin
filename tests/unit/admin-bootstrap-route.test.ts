import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeAdminBootstrapRateLimit: vi.fn(),
  listUsers: vi.fn(),
  rpc: vi.fn(),
  selectMemberships: vi.fn(),
}));

vi.mock("@/lib/auth/bootstrap-rate-limit", () => ({
  consumeAdminBootstrapRateLimit: mocks.consumeAdminBootstrapRateLimit,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { listUsers: mocks.listUsers } },
    from: () => ({ select: mocks.selectMemberships }),
    rpc: mocks.rpc,
  }),
}));

import { POST } from "@/app/api/admin/bootstrap/route";

const allowedEmail = "bootstrap-admin@example.test";
const configuredSecret = "configured-bootstrap-secret-value";

function request(secret = "wrong-bootstrap-secret-value"): Request {
  return new Request("https://hometogether.test/api/admin/bootstrap", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://hometogether.test",
      "x-real-ip": "203.0.113.40",
    },
    body: JSON.stringify({ email: allowedEmail, bootstrapSecret: secret }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_EMAILS = allowedEmail;
  process.env.ADMIN_BOOTSTRAP_SECRET = configuredSecret;
  mocks.consumeAdminBootstrapRateLimit.mockResolvedValue(true);
  mocks.selectMemberships.mockResolvedValue({ count: 0, error: null });
  mocks.listUsers.mockResolvedValue({
    data: {
      users: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: allowedEmail,
          email_confirmed_at: "2026-08-09T00:00:00.000Z",
        },
      ],
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_BOOTSTRAP_SECRET;
});

describe("administrator bootstrap route", () => {
  it("rate-limits repeated secret guesses before any Auth or membership lookup", async () => {
    mocks.consumeAdminBootstrapRateLimit
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await POST(request()));
    }

    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
    expect(responses[5]?.status).toBe(429);
    expect(responses[5]?.headers.get("retry-after")).toBe("900");
    expect(mocks.consumeAdminBootstrapRateLimit).toHaveBeenCalledTimes(6);
    expect(mocks.selectMemberships).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves allowlist, verified-user and singleton RPC checks on success", async () => {
    const response = await POST(request(configuredSecret));

    expect(response.status).toBe(201);
    expect(mocks.selectMemberships).toHaveBeenCalledOnce();
    expect(mocks.listUsers).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("bootstrap_first_admin", {
      p_user_id: "00000000-0000-4000-8000-000000000001",
      p_expected_email: allowedEmail,
    });
  });

  it("does not consume a limiter bucket after bootstrap configuration is removed", async () => {
    delete process.env.ADMIN_BOOTSTRAP_SECRET;

    const response = await POST(request(configuredSecret));

    expect(response.status).toBe(503);
    expect(mocks.consumeAdminBootstrapRateLimit).not.toHaveBeenCalled();
    expect(mocks.selectMemberships).not.toHaveBeenCalled();
  });

  it("rejects an unverified allowlisted Auth user without calling the singleton RPC", async () => {
    mocks.listUsers.mockResolvedValue({
      data: { users: [{ id: "user-1", email: allowedEmail, email_confirmed_at: null }] },
      error: null,
    });

    const response = await POST(request(configuredSecret));

    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
