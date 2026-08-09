import type {
  CheckinIssueInput,
  CheckinSubmission,
  RiskHistoryContext,
  RiskLevel,
  RiskResult,
} from "@/lib/checkin/types";

const SCORE: Record<RiskLevel, number> = {
  GREEN: 0,
  YELLOW: 1,
  ORANGE: 2,
  RED: 3,
};

const LEVEL_BY_SCORE: RiskLevel[] = ["GREEN", "YELLOW", "ORANGE", "RED"];

const RED_SUBCATEGORIES = new Set([
  "SEXUAL_REMARK_OR_BEHAVIOR",
  "UNWANTED_PHYSICAL_CONTACT",
  "PHYSICAL_THREAT_VIOLENCE",
  "AFRAID_TO_STAY",
]);

const ORANGE_PRIVACY_SUBCATEGORIES = new Set([
  "ROOM_ENTRY_WITHOUT_PERMISSION",
  "CAMERA_RECORDING_CONCERN",
]);

const REPEATED_FREQUENCIES = new Set(["SEVERAL_TIMES", "ALMOST_DAILY", "ONGOING"]);

export function isPairedRiskMismatch(
  left: RiskLevel,
  right: RiskLevel | undefined,
): boolean {
  return (
    (left === "GREEN" && (right === "ORANGE" || right === "RED")) ||
    (right === "GREEN" && (left === "ORANGE" || left === "RED"))
  );
}

function setAtLeast(current: RiskLevel, minimum: RiskLevel): RiskLevel {
  return SCORE[current] >= SCORE[minimum] ? current : minimum;
}

function addReason(reasons: Set<string>, reason: string) {
  reasons.add(reason);
}

function evaluateIssue(issue: CheckinIssueInput, reasons: Set<string>): RiskLevel {
  let level: RiskLevel = "GREEN";

  if (issue.category === "SAFETY") {
    level = "RED";
    addReason(reasons, "SAFETY_CATEGORY");
  }
  if (RED_SUBCATEGORIES.has(issue.subcategory)) {
    level = "RED";
    addReason(reasons, `SAFETY_SUBCATEGORY:${issue.subcategory}`);
  }
  if (issue.severity === 5) {
    level = "RED";
    addReason(reasons, "SEVERITY_5");
  } else if (issue.severity === 4) {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "SEVERITY_4");
  } else if (issue.severity === 3) {
    level = setAtLeast(level, "YELLOW");
    addReason(reasons, "SEVERITY_3");
  }

  if (issue.discussionStatus === "WORSENED_AFTER_DISCUSSION") {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "WORSENED_AFTER_DISCUSSION");
  }
  if (issue.discussionStatus === "DIFFICULT_TO_DISCUSS") {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "DIFFICULT_TO_DISCUSS");
  }
  if (issue.desiredAction === "URGENT_CONTACT") {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "URGENT_CONTACT_REQUESTED");
  }
  if (issue.desiredAction === "RELOCATION_EXIT_CONSULT") {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "RELOCATION_EXIT_CONSULT_REQUESTED");
  }

  if (issue.frequency === "ALMOST_DAILY" || issue.frequency === "ONGOING") {
    level = setAtLeast(level, "YELLOW");
    addReason(reasons, `HIGH_FREQUENCY:${issue.frequency}`);
  }

  const isRepeated = REPEATED_FREQUENCIES.has(issue.frequency);
  if (
    issue.category === "CARE_PRESSURE" &&
    issue.severity >= 3 &&
    (isRepeated || issue.subcategory === "REPEATED_AFTER_REFUSAL")
  ) {
    level = setAtLeast(level, "ORANGE");
    addReason(reasons, "REPEATED_CARE_PRESSURE");
  }

  if (issue.category === "PRIVACY_BOUNDARY") {
    if (ORANGE_PRIVACY_SUBCATEGORIES.has(issue.subcategory)) {
      level = setAtLeast(level, "ORANGE");
      addReason(reasons, `PRIVACY_ORANGE_CANDIDATE:${issue.subcategory}`);
    }
    if (issue.severity >= 3 && isRepeated) {
      level = setAtLeast(level, "ORANGE");
      addReason(reasons, "REPEATED_PRIVACY_INTRUSION");
    }
  }

  const requestedSupport = issue.desiredAction !== "RECORD_ONLY";
  if (level === "GREEN" && requestedSupport) {
    level = "YELLOW";
    addReason(reasons, "SUPPORT_REQUESTED");
  }

  return level;
}

/**
 * Server-side only, deterministic risk calculation. Callers must not accept a
 * risk level supplied by the browser.
 */
export function calculateRisk(
  submission: CheckinSubmission,
  history: RiskHistoryContext = {},
): RiskResult {
  const reasons = new Set<string>();
  let riskLevel: RiskLevel = "GREEN";

  if (submission.overallStatus === "NEED_HELP_NOW") {
    riskLevel = "RED";
    addReason(reasons, "NEED_HELP_NOW");
  }

  if (submission.safety?.immediateDanger === "IMMEDIATE_DANGER") {
    riskLevel = "RED";
    addReason(reasons, "IMMEDIATE_DANGER");
  }

  for (const issue of submission.issues) {
    riskLevel = setAtLeast(riskLevel, evaluateIssue(issue, reasons));
  }

  if (submission.issueStatus === "WORSENING") {
    riskLevel = setAtLeast(riskLevel, "YELLOW");
    addReason(reasons, "ISSUE_WORSENING");
  }

  if (
    submission.overallStatus === "SLIGHTLY_UNCOMFORTABLE" ||
    submission.overallStatus === "VERY_UNCOMFORTABLE"
  ) {
    riskLevel = setAtLeast(riskLevel, "YELLOW");
    addReason(reasons, `OVERALL_STATUS:${submission.overallStatus}`);
  }

  const repeatedSubcategories = new Set(history.repeatedSubcategories ?? []);
  const repeatedThisWeek = submission.issues.some((issue) =>
    repeatedSubcategories.has(issue.subcategory),
  );
  if (repeatedThisWeek) {
    const previous = riskLevel;
    riskLevel = LEVEL_BY_SCORE[Math.min(SCORE[riskLevel] + 1, SCORE.RED)];
    addReason(reasons, `REPEATED_SUBCATEGORY_ESCALATION:${previous}->${riskLevel}`);
  }

  if ((history.consecutiveMissedWeeks ?? 0) >= 2) {
    riskLevel = setAtLeast(riskLevel, "YELLOW");
    addReason(reasons, "TWO_CONSECUTIVE_NON_RESPONSES");
  }

  const counterpart = history.counterpartRiskLevel;
  const pairedMismatch = isPairedRiskMismatch(riskLevel, counterpart);

  if (pairedMismatch) {
    riskLevel = setAtLeast(riskLevel, "YELLOW");
    addReason(reasons, "PAIRED_RISK_MISMATCH");
  }

  if (reasons.size === 0) {
    if (submission.issueStatus === "RESOLVED") addReason(reasons, "ISSUE_RESOLVED");
    else if (submission.issueStatus === "NO_ISSUE") addReason(reasons, "NO_ISSUE");
    else addReason(reasons, "LOW_RISK");
  }

  return {
    riskLevel,
    riskReasons: [...reasons],
    pairedMismatch,
    requiresSupportCase: riskLevel === "RED",
  };
}
