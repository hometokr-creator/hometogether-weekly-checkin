import { describe, expect, it } from "vitest";

import { calculateRisk } from "@/lib/checkin/calculate-risk";
import { QUESTIONNAIRE_VERSION, type CheckinSubmission } from "@/lib/checkin/types";

function submission(overrides: Partial<CheckinSubmission> = {}): CheckinSubmission {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "VERY_GOOD",
    issueStatus: "NO_ISSUE",
    positivePoints: ["NO_SPECIAL_EVENT"],
    issues: [],
    questionSnapshot: {},
    ...overrides,
  };
}

describe("calculateRisk", () => {
  it("calculates GREEN for the no-issue path", () => {
    expect(calculateRisk(submission())).toMatchObject({
      riskLevel: "GREEN",
      requiresSupportCase: false,
    });
  });

  it("calculates YELLOW for a cleanliness issue with severity 3", () => {
    const result = calculateRisk(
      submission({
        overallStatus: "SLIGHTLY_UNCOMFORTABLE",
        issueStatus: "UNRESOLVED",
        positivePoints: [],
        issues: [
          {
            category: "CLEANLINESS",
            subcategory: "BATHROOM_CLEANING",
            frequency: "TWO_OR_THREE",
            severity: 3,
            discussionStatus: "NOT_DISCLOSED",
            desiredAction: "RECORD_ONLY",
          },
        ],
      }),
    );

    expect(result.riskLevel).toBe("YELLOW");
    expect(result.riskReasons).toContain("SEVERITY_3");
  });

  it("calculates ORANGE for repeated care pressure", () => {
    const result = calculateRisk(
      submission({
        overallStatus: "VERY_UNCOMFORTABLE",
        issueStatus: "REPEATED",
        positivePoints: [],
        issues: [
          {
            category: "CARE_PRESSURE",
            subcategory: "REPEATED_AFTER_REFUSAL",
            frequency: "SEVERAL_TIMES",
            severity: 4,
            discussionStatus: "DISCUSSED_UNRESOLVED",
            desiredAction: "PHONE_CONSULT",
          },
        ],
      }),
    );

    expect(result.riskLevel).toBe("ORANGE");
    expect(result.riskReasons).toContain("REPEATED_CARE_PRESSURE");
  });

  it("always keeps safety and physical threats RED", () => {
    const result = calculateRisk(
      submission({
        overallStatus: "VERY_UNCOMFORTABLE",
        issueStatus: "UNRESOLVED",
        positivePoints: [],
        issues: [
          {
            category: "SAFETY",
            subcategory: "PHYSICAL_THREAT_VIOLENCE",
            frequency: "ONCE",
            severity: 5,
            discussionStatus: "DIFFICULT_TO_DISCUSS",
            desiredAction: "URGENT_CONTACT",
          },
        ],
        safety: {
          immediateDanger: "IMMEDIATE_DANGER",
          safeToContact: "NOT_SAFE_TO_CONTACT_NOW",
          safeLocation: "NO",
        },
      }),
      { repeatedSubcategories: ["PHYSICAL_THREAT_VIOLENCE"] },
    );

    expect(result.riskLevel).toBe("RED");
    expect(result.requiresSupportCase).toBe(true);
  });

  it("raises a repeated subcategory by one level", () => {
    const result = calculateRisk(
      submission({
        issueStatus: "UNRESOLVED",
        positivePoints: [],
        issues: [
          {
            category: "CLEANLINESS",
            subcategory: "DISHES",
            frequency: "ONCE",
            severity: 2,
            discussionStatus: "NOT_DISCLOSED",
            desiredAction: "RECORD_ONLY",
          },
        ],
      }),
      { repeatedSubcategories: ["DISHES"] },
    );

    expect(result.riskLevel).toBe("YELLOW");
    expect(result.riskReasons.some((reason) => reason.startsWith("REPEATED_SUBCATEGORY"))).toBe(
      true,
    );
  });

  it("flags a GREEN vs ORANGE/RED counterpart mismatch", () => {
    const result = calculateRisk(submission(), { counterpartRiskLevel: "RED" });

    expect(result.pairedMismatch).toBe(true);
    expect(result.riskLevel).toBe("YELLOW");
  });
});
