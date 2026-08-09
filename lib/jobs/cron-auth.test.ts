import { afterEach, describe, expect, it } from "vitest";

import { isAuthorizedCronRequest } from "@/lib/jobs/cron-auth";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("cron authorization", () => {
  it("fails closed for a missing or short secret", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCronRequest(new Request("https://example.test"))).toBe(false);
    process.env.CRON_SECRET = "too-short";
    expect(
      isAuthorizedCronRequest(
        new Request("https://example.test", { headers: { authorization: "Bearer too-short" } }),
      ),
    ).toBe(false);
  });

  it("accepts only the exact bearer secret", () => {
    process.env.CRON_SECRET = "cron-secret-at-least-16-characters";
    const request = new Request("https://example.test", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(isAuthorizedCronRequest(request)).toBe(true);
    expect(
      isAuthorizedCronRequest(
        new Request("https://example.test", { headers: { authorization: "Bearer wrong-secret" } }),
      ),
    ).toBe(false);
  });
});
