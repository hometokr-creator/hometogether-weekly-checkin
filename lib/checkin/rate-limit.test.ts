import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/checkin/repository-factory", () => ({
  hasSupabaseServerConfig: () => true,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

describe("public check-in rate limits", () => {
  beforeEach(() => {
    rpc.mockReset();
    process.env.RATE_LIMIT_HMAC_SECRET = "rate-limit-test-secret-at-least-32-characters";
    process.env.CUSTOM_CHECKIN_DOMAIN = "checkin.hometogether.kr";
    process.env.PUBLIC_CHECKIN_BASE_URL = "https://checkin.hometogether.kr";
  });

  it("uses Cloudflare's visitor IP only for a trusted Cloudflare source and configured host", async () => {
    const { extractClientAddress } = await import("@/lib/checkin/rate-limit");
    const cloudflareHeaders = new Headers({
      host: "checkin.hometogether.kr",
      "x-real-ip": "172.67.179.108",
      "cf-connecting-ip": "203.0.113.27",
    });
    expect(
      extractClientAddress(cloudflareHeaders, "https://checkin.hometogether.kr/checkin"),
    ).toBe("203.0.113.27");

    const directAliasHeaders = new Headers({
      host: "hometogether-weekly-checkin.vercel.app",
      "x-real-ip": "198.51.100.8",
      "cf-connecting-ip": "203.0.113.99",
    });
    expect(
      extractClientAddress(
        directAliasHeaders,
        "https://hometogether-weekly-checkin.vercel.app/checkin",
      ),
    ).toBe("198.51.100.8");

    const spoofedProxyHeaders = new Headers({
      host: "checkin.hometogether.kr",
      "x-real-ip": "198.51.100.8",
      "cf-connecting-ip": "203.0.113.99",
    });
    expect(
      extractClientAddress(spoofedProxyHeaders, "https://checkin.hometogether.kr/checkin"),
    ).toBe("198.51.100.8");
  });

  it("accepts Cloudflare IPv6 edge ranges and visitor addresses", async () => {
    const { extractClientAddress } = await import("@/lib/checkin/rate-limit");
    expect(
      extractClientAddress(
        new Headers({
          host: "checkin.hometogether.kr",
          "x-real-ip": "2606:4700:10::ac43:1234",
          "cf-connecting-ip": "2001:db8::42",
        }),
        "https://checkin.hometogether.kr/checkin",
      ),
    ).toBe("2001:db8::42");
  });

  it("uses one privacy-safe IP bucket before token lookup", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ allowed: true, remaining: 59, reset_at: "2026-08-07T00:01:00Z" }],
      error: null,
    });
    const { consumePublicIpRateLimit } = await import("@/lib/checkin/rate-limit");
    await expect(
      consumePublicIpRateLimit({
        clientAddress: "203.0.113.10",
        scope: "lookup",
        limit: 60,
      }),
    ).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({
        p_limit: 60,
        p_route: "public-checkin:lookup:ip",
      }),
    );
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(args.p_bucket_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.10");
  });

  it("keeps the per-token limiter for a validated invitation", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const { consumeCheckinRateLimit } = await import("@/lib/checkin/rate-limit");
    await expect(
      consumeCheckinRateLimit({
        tokenHash: "a".repeat(64),
        clientAddress: "203.0.113.10",
        scope: "submit",
        limit: 10,
      }),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "consume_checkin_rate_limit",
      expect.objectContaining({ p_token_hash: "a".repeat(64), p_limit: 10 }),
    );
  });
});
