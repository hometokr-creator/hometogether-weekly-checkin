import { describe, expect, it } from "vitest";

import {
  calculateInvitationExpiry,
  createOpaqueToken,
  hashToken,
  tokenHashMatches,
} from "@/lib/checkin/token";

describe("check-in tokens", () => {
  it("creates a 256-bit URL-safe opaque token and stores only its hash", () => {
    const token = createOpaqueToken();
    const hash = hashToken(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(tokenHashMatches(token, hash)).toBe(true);
    expect(tokenHashMatches(`${token}a`, hash)).toBe(false);
  });

  it("expires a Sunday invitation at the end of Wednesday KST", () => {
    const created = new Date("2026-08-02T09:00:00.000Z"); // Sunday 18:00 KST
    expect(calculateInvitationExpiry(created).toISOString()).toBe("2026-08-05T15:00:00.000Z");
  });
});
