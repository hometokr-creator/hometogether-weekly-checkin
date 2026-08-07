import { describe, expect, it } from "vitest";

import {
  detectSafetyTriggers,
  getNextStepAfterCategory,
  getNextStepAfterIssueStatus,
  getNextStepAfterSeverity,
  getNextStepAfterSubcategory,
  isValidSubcategory,
  nextStepAfterAdditionalIssue,
} from "@/lib/checkin/branching-engine";
import {
  QUESTIONNAIRE_VERSION,
  WEEKLY_CHECKIN_QUESTIONNAIRE,
  createQuestionnaireSnapshot,
  issueSubcategoryOptions,
} from "@/lib/checkin/question-tree";

describe("versioned questionnaire definition", () => {
  it("contains every requested category-scoped subcategory", () => {
    expect(
      Object.fromEntries(
        Object.entries(issueSubcategoryOptions).map(([category, options]) => [
          category,
          options.length,
        ]),
      ),
    ).toEqual({
      CLEANLINESS: 12,
      SHARED_SPACE: 11,
      NOISE_SLEEP: 10,
      HOUSE_RULES: 14,
      PRIVACY_BOUNDARY: 12,
      COMMUNICATION: 12,
      CARE_PRESSURE: 14,
      PAYMENT_CONTRACT: 13,
      FACILITY_REPAIR: 16,
      SAFETY: 12,
      UNKNOWN: 1,
    });

    expect(isValidSubcategory("CLEANLINESS", "BATHROOM_CLEANING")).toBe(true);
    expect(isValidSubcategory("CLEANLINESS", "PHYSICAL_THREAT_VIOLENCE")).toBe(false);
  });

  it("returns a detached, versioned snapshot for response persistence", () => {
    const snapshot = createQuestionnaireSnapshot();
    expect(snapshot.version).toBe(QUESTIONNAIRE_VERSION);

    snapshot.version = "tampered";
    expect(WEEKLY_CHECKIN_QUESTIONNAIRE.version).toBe(QUESTIONNAIRE_VERSION);
  });
});

describe("deterministic branching", () => {
  it("routes no-issue, issue, and safety choices to the correct branches", () => {
    expect(getNextStepAfterIssueStatus("NO_ISSUE")).toBe("POSITIVE_POINTS");
    expect(getNextStepAfterIssueStatus("UNRESOLVED")).toBe("ISSUE_CATEGORY");
    expect(getNextStepAfterCategory("SAFETY")).toBe("SAFETY_IMMEDIATE_DANGER");
    expect(getNextStepAfterCategory("CLEANLINESS")).toBe("ISSUE_SUBCATEGORY");
    expect(getNextStepAfterSubcategory("CLEANLINESS", "OTHER_CLEANLINESS")).toBe(
      "CLARIFICATION_PREFERENCE",
    );
    expect(getNextStepAfterSeverity({ severity: 5 })).toBe("SAFETY_IMMEDIATE_DANGER");
  });

  it("reports safety triggers in a stable priority order", () => {
    expect(
      detectSafetyTriggers({
        issues: [
          { subcategory: "AFRAID_TO_STAY" },
          { category: "SAFETY", severity: 5, subcategory: "UNWANTED_PHYSICAL_CONTACT" },
        ],
        overallStatus: "NEED_HELP_NOW",
        immediateDanger: "IMMEDIATE_DANGER",
      }),
    ).toEqual([
      "NEED_HELP_NOW",
      "SAFETY_CATEGORY",
      "SEVERITY_5",
      "UNWANTED_PHYSICAL_CONTACT",
      "AFRAID_TO_STAY",
      "IMMEDIATE_DANGER",
    ]);
  });

  it("caps issue collection at three entries", () => {
    expect(nextStepAfterAdditionalIssue(1, true)).toBe("ISSUE_CATEGORY");
    expect(nextStepAfterAdditionalIssue(3, true)).toBe("COMPLETE");
    expect(nextStepAfterAdditionalIssue(2, false)).toBe("COMPLETE");
  });
});

