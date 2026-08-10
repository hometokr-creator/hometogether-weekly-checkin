import { describe, expect, it } from "vitest";

import { needsAdminAal2 } from "@/lib/auth/mfa-policy";

describe("administrator MFA rollout policy", () => {
  it("does not lock the existing administrator before enrollment", () => {
    expect(needsAdminAal2({
      currentLevel: "aal1",
      enrolled: false,
      enforcementEnabled: false,
    })).toBe(false);
  });

  it("requires step-up as soon as a verified factor exists", () => {
    expect(needsAdminAal2({
      currentLevel: "aal1",
      enrolled: true,
      enforcementEnabled: false,
    })).toBe(true);
  });

  it("uses the authoritative next assurance level when user factors are stale", () => {
    expect(needsAdminAal2({
      currentLevel: "aal1",
      nextLevel: "aal2",
      enrolled: false,
      enforcementEnabled: false,
    })).toBe(true);
  });

  it("accepts an AAL2 session when global enforcement is enabled", () => {
    expect(needsAdminAal2({
      currentLevel: "aal2",
      enrolled: true,
      enforcementEnabled: true,
    })).toBe(false);
  });
});
