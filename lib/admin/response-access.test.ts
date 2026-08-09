import { describe, expect, it } from "vitest";

import { responseRequiresSafetyPermission } from "@/lib/admin/response-access";

const ordinary = {
  riskLevel: "GREEN",
  immediateDanger: null,
  safeToContact: null,
  safeLocation: null,
  hasSafetyIssue: false,
  hasSupportCase: false,
};

describe("response detail access classification", () => {
  it("keeps an ordinary response behind CHECKIN_READ", () => {
    expect(responseRequiresSafetyPermission(ordinary)).toBe(false);
  });

  it("classifies every safety signal and support case as SAFETY_READ", () => {
    expect(responseRequiresSafetyPermission({ ...ordinary, riskLevel: "RED" })).toBe(true);
    expect(responseRequiresSafetyPermission({
      ...ordinary,
      immediateDanger: "NOT_IMMEDIATE",
    })).toBe(true);
    expect(responseRequiresSafetyPermission({ ...ordinary, hasSafetyIssue: true })).toBe(true);
    expect(responseRequiresSafetyPermission({ ...ordinary, hasSupportCase: true })).toBe(true);
  });
});
