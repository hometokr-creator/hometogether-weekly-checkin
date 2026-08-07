import {
  MAX_ISSUES_PER_CHECKIN,
  SAFETY_TRIGGER_CATEGORIES,
  SAFETY_TRIGGER_OVERALL_STATUSES,
  SAFETY_TRIGGER_SUBCATEGORIES,
  issueSubcategoryOptions,
} from "@/lib/checkin/question-tree";
import type {
  CheckinIssueInput,
  ContactMethod,
  DisclosurePreference,
  ImmediateDanger,
  IssueCategory,
  IssueStatus,
  OverallStatus,
  SafetyAnswers,
} from "@/lib/checkin/types";

export const checkinStepIds = [
  "OVERALL_STATUS",
  "ISSUE_STATUS",
  "POSITIVE_POINTS",
  "ISSUE_CATEGORY",
  "ISSUE_SUBCATEGORY",
  "CLARIFICATION_PREFERENCE",
  "FREQUENCY",
  "SEVERITY",
  "DISCUSSION_STATUS",
  "DESIRED_ACTION",
  "DISCLOSURE_PREFERENCE",
  "CONTACT_METHOD",
  "CONTACT_WINDOW",
  "ADDITIONAL_ISSUE",
  "SAFETY_IMMEDIATE_DANGER",
  "SAFETY_SAFE_TO_CONTACT",
  "SAFETY_SAFE_LOCATION",
  "COMPLETE",
] as const;

export type CheckinStepId = (typeof checkinStepIds)[number];
export type CheckinBranch = "STANDARD" | "POSITIVE" | "ISSUE" | "SAFETY";

export const safetyTriggerReasons = [
  "NEED_HELP_NOW",
  "SAFETY_CATEGORY",
  "SEVERITY_5",
  "UNWANTED_PHYSICAL_CONTACT",
  "SEXUAL_REMARK_OR_BEHAVIOR",
  "PHYSICAL_THREAT_VIOLENCE",
  "AFRAID_TO_STAY",
  "IMMEDIATE_DANGER",
] as const;

export type SafetyTriggerReason = (typeof safetyTriggerReasons)[number];

export interface SafetyTriggerIssue {
  readonly category?: IssueCategory;
  readonly subcategory?: string;
  readonly severity?: number;
}

export interface SafetyTriggerInput {
  readonly overallStatus?: OverallStatus;
  readonly issue?: SafetyTriggerIssue;
  readonly issues?: readonly SafetyTriggerIssue[];
  readonly immediateDanger?: ImmediateDanger;
  readonly safety?: Partial<SafetyAnswers>;
}

export interface BranchingAnswers {
  readonly overallStatus?: OverallStatus;
  readonly issueStatus?: IssueStatus;
  readonly currentIssue?: SafetyTriggerIssue;
  readonly issues?: readonly SafetyTriggerIssue[];
  readonly disclosurePreference?: DisclosurePreference;
  readonly contactMethod?: ContactMethod;
  readonly wantsAnotherIssue?: boolean;
  readonly immediateDanger?: ImmediateDanger;
  readonly safety?: Partial<SafetyAnswers>;
}

export interface NextStepInput {
  readonly currentStep: CheckinStepId;
  readonly answers: BranchingAnswers;
}

const safetySubcategorySet = new Set<string>(SAFETY_TRIGGER_SUBCATEGORIES);
const safetyCategorySet = new Set<IssueCategory>(SAFETY_TRIGGER_CATEGORIES);
const safetyOverallStatusSet = new Set<OverallStatus>(SAFETY_TRIGGER_OVERALL_STATUSES);

function appendOnce(reasons: SafetyTriggerReason[], reason: SafetyTriggerReason): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function collectIssueSafetyReasons(
  issue: SafetyTriggerIssue,
  reasons: SafetyTriggerReason[],
): void {
  if (issue.category && safetyCategorySet.has(issue.category)) {
    appendOnce(reasons, "SAFETY_CATEGORY");
  }

  if (issue.severity === 5) {
    appendOnce(reasons, "SEVERITY_5");
  }

  if (
    issue.subcategory &&
    safetySubcategorySet.has(issue.subcategory)
  ) {
    appendOnce(reasons, issue.subcategory as SafetyTriggerReason);
  }
}

/** Returns safety reasons in a stable priority order, regardless of issue order. */
export function detectSafetyTriggers(input: SafetyTriggerInput): SafetyTriggerReason[] {
  const discovered: SafetyTriggerReason[] = [];

  if (input.overallStatus && safetyOverallStatusSet.has(input.overallStatus)) {
    appendOnce(discovered, "NEED_HELP_NOW");
  }

  if (input.issue) {
    collectIssueSafetyReasons(input.issue, discovered);
  }

  for (const issue of input.issues ?? []) {
    collectIssueSafetyReasons(issue, discovered);
  }

  const immediateDanger = input.immediateDanger ?? input.safety?.immediateDanger;
  if (immediateDanger === "IMMEDIATE_DANGER") {
    appendOnce(discovered, "IMMEDIATE_DANGER");
  }

  return safetyTriggerReasons.filter((reason) => discovered.includes(reason));
}

export function shouldEnterSafetyFlow(input: SafetyTriggerInput): boolean {
  return detectSafetyTriggers(input).length > 0;
}

export const hasSafetyTrigger = shouldEnterSafetyFlow;
export const isSafetyTrigger = shouldEnterSafetyFlow;

export function getBranchAfterOverallStatus(overallStatus: OverallStatus): CheckinBranch {
  return shouldEnterSafetyFlow({ overallStatus }) ? "SAFETY" : "STANDARD";
}

export function getBranchAfterIssueStatus(issueStatus: IssueStatus): CheckinBranch {
  return issueStatus === "NO_ISSUE" ? "POSITIVE" : "ISSUE";
}

export function getNextStepAfterOverallStatus(overallStatus: OverallStatus): CheckinStepId {
  return getBranchAfterOverallStatus(overallStatus) === "SAFETY"
    ? "SAFETY_IMMEDIATE_DANGER"
    : "ISSUE_STATUS";
}

export function getNextStepAfterIssueStatus(issueStatus: IssueStatus): CheckinStepId {
  return getBranchAfterIssueStatus(issueStatus) === "POSITIVE"
    ? "POSITIVE_POINTS"
    : "ISSUE_CATEGORY";
}

export function getNextStepAfterCategory(category: IssueCategory): CheckinStepId {
  return shouldEnterSafetyFlow({ issue: { category } })
    ? "SAFETY_IMMEDIATE_DANGER"
    : "ISSUE_SUBCATEGORY";
}

export function requiresClarificationPreference(
  category: IssueCategory,
  subcategory: string,
): boolean {
  return (
    category === "UNKNOWN" ||
    subcategory === "UNKNOWN" ||
    subcategory.startsWith("OTHER_")
  );
}

export function isValidSubcategory(category: IssueCategory, subcategory: string): boolean {
  return issueSubcategoryOptions[category].some((option) => option.value === subcategory);
}

export function getNextStepAfterSubcategory(
  category: IssueCategory,
  subcategory: string,
): CheckinStepId {
  if (shouldEnterSafetyFlow({ issue: { category, subcategory } })) {
    return "SAFETY_IMMEDIATE_DANGER";
  }

  return requiresClarificationPreference(category, subcategory)
    ? "CLARIFICATION_PREFERENCE"
    : "FREQUENCY";
}

export function getNextStepAfterSeverity(issue: SafetyTriggerIssue): CheckinStepId {
  return shouldEnterSafetyFlow({ issue })
    ? "SAFETY_IMMEDIATE_DANGER"
    : "DISCUSSION_STATUS";
}

export function canAddAnotherIssue(issueCount: number): boolean {
  return Number.isInteger(issueCount) && issueCount >= 0 && issueCount < MAX_ISSUES_PER_CHECKIN;
}

export function nextStepAfterAdditionalIssue(
  issueCount: number,
  wantsAnotherIssue: boolean,
): CheckinStepId {
  return wantsAnotherIssue && canAddAnotherIssue(issueCount)
    ? "ISSUE_CATEGORY"
    : "COMPLETE";
}

function activeIssue(answers: BranchingAnswers): SafetyTriggerIssue | undefined {
  return answers.currentIssue ?? answers.issues?.at(-1);
}

/**
 * Resolves the next UI step from the current step and answer state. The helper
 * never mutates answers and always gives safety precedence over the normal path.
 */
export function getNextCheckinStep({
  currentStep,
  answers,
}: NextStepInput): CheckinStepId | null {
  if (
    currentStep !== "SAFETY_IMMEDIATE_DANGER" &&
    currentStep !== "SAFETY_SAFE_TO_CONTACT" &&
    currentStep !== "SAFETY_SAFE_LOCATION" &&
    currentStep !== "COMPLETE" &&
    shouldEnterSafetyFlow({
      overallStatus: answers.overallStatus,
      issue: answers.currentIssue,
      issues: answers.issues,
      immediateDanger: answers.immediateDanger,
      safety: answers.safety,
    })
  ) {
    return "SAFETY_IMMEDIATE_DANGER";
  }

  switch (currentStep) {
    case "OVERALL_STATUS":
      return answers.overallStatus
        ? getNextStepAfterOverallStatus(answers.overallStatus)
        : "OVERALL_STATUS";
    case "ISSUE_STATUS":
      return answers.issueStatus
        ? getNextStepAfterIssueStatus(answers.issueStatus)
        : "ISSUE_STATUS";
    case "POSITIVE_POINTS":
      return "COMPLETE";
    case "ISSUE_CATEGORY": {
      const issue = activeIssue(answers);
      return issue?.category ? getNextStepAfterCategory(issue.category) : "ISSUE_CATEGORY";
    }
    case "ISSUE_SUBCATEGORY": {
      const issue = activeIssue(answers);
      return issue?.category && issue.subcategory
        ? getNextStepAfterSubcategory(issue.category, issue.subcategory)
        : "ISSUE_SUBCATEGORY";
    }
    case "CLARIFICATION_PREFERENCE":
      return "FREQUENCY";
    case "FREQUENCY":
      return "SEVERITY";
    case "SEVERITY": {
      const issue = activeIssue(answers);
      return issue ? getNextStepAfterSeverity(issue) : "SEVERITY";
    }
    case "DISCUSSION_STATUS":
      return "DESIRED_ACTION";
    case "DESIRED_ACTION":
      return answers.disclosurePreference
        ? "ADDITIONAL_ISSUE"
        : "DISCLOSURE_PREFERENCE";
    case "DISCLOSURE_PREFERENCE":
      return "CONTACT_METHOD";
    case "CONTACT_METHOD":
      return answers.contactMethod === "NO_CONTACT"
        ? "ADDITIONAL_ISSUE"
        : "CONTACT_WINDOW";
    case "CONTACT_WINDOW":
      return "ADDITIONAL_ISSUE";
    case "ADDITIONAL_ISSUE":
      return nextStepAfterAdditionalIssue(
        answers.issues?.length ?? 0,
        answers.wantsAnotherIssue === true,
      );
    case "SAFETY_IMMEDIATE_DANGER":
      return "SAFETY_SAFE_TO_CONTACT";
    case "SAFETY_SAFE_TO_CONTACT":
      return "SAFETY_SAFE_LOCATION";
    case "SAFETY_SAFE_LOCATION":
      return "COMPLETE";
    case "COMPLETE":
      return null;
  }
}

export const resolveNextStep = getNextCheckinStep;

/** Convenience overload for consumers that already have a complete issue. */
export function issueRequiresSafetyFlow(issue: Pick<CheckinIssueInput, "category" | "subcategory" | "severity">): boolean {
  return shouldEnterSafetyFlow({ issue });
}

