import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/checkin/repository-factory", () => ({
  hasSupabaseServerConfig: () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

import { consumeAdminBootstrapRateLimit } from "@/lib/auth/bootstrap-rate-limit";

describe("administrator bootstrap rate limit", () => {
  beforeEach(() => {
    rpc.mockReset();
    process.env.RATE_LIMIT_HMAC_SECRET = "bootstrap-rate-limit-test-secret-at-least-32-characters";
  });

  it("uses an independent privacy-safe database bucket", async () => {
    rpc.mockResolvedValue({
      data: [{ allowed: true, remaining: 4, reset_at: "2026-08-09T00:15:00Z" }],
      error: null,
    });

    await expect(
      consumeAdminBootstrapRateLimit({ clientAddress: "203.0.113.25" }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({
        p_route: "admin-bootstrap",
        p_limit: 5,
        p_window_seconds: 900,
      }),
    );
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(args.p_bucket_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.25");
    expect(JSON.stringify(args)).not.toContain("public-checkin");
  });
});
