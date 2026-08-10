import type { AdminMembershipPermission } from "@/lib/auth/admin";
import type {
  CheckinSubmission,
  DashboardData,
  DashboardResponseRow,
  SupportCaseSummary,
} from "@/lib/checkin/types";

function hasPermission(
  permissions: readonly AdminMembershipPermission[],
  permission: AdminMembershipPermission,
): boolean {
  return permissions.includes("SUPER_ADMIN") || permissions.includes(permission);
}
export function maskDisplayName(value: string): string {
  const name = value.trim();
  if (!name || name === "응답자") return "응답자";
  const characters = Array.from(name);
  if (characters.length === 1) return `${characters[0]}*`;
  return `${characters[0]}${"*".repeat(Math.min(characters.length - 1, 3))}`;
}

/**
 * Removes browser-submitted snapshots and free text from ordinary operational
 * views. Safety readers retain the structured safety fields and free-text
 * notes they need to handle a case, but no admin UI receives questionSnapshot.
 */
export function minimizeSubmission(
  submission: CheckinSubmission,
  permissions: readonly AdminMembershipPermission[],
): CheckinSubmission {
  const canReadSafety = hasPermission(permissions, "SAFETY_READ");
  return {
    ...submission,
    issues: submission.issues.map((issue) => ({
      ...issue,
      additionalNote: canReadSafety ? issue.additionalNote : undefined,
    })),
    safety: canReadSafety ? submission.safety : undefined,
    questionSnapshot: {},
  };
}

function minimizeSupportCase(
  supportCase: SupportCaseSummary | undefined,
  permissions: readonly AdminMembershipPermission[],
): SupportCaseSummary | undefined {
  if (!supportCase) return undefined;
  return {
    ...supportCase,
    internalNote: hasPermission(permissions, "SAFETY_READ")
      ? supportCase.internalNote
      : undefined,
  };
}

export function minimizeDashboardResponse(
  response: DashboardResponseRow,
  permissions: readonly AdminMembershipPermission[],
): DashboardResponseRow {
  return {
    ...response,
    // Identity is masked by default even for SUPER_ADMIN. Raw contact access
    // is a separate, audited operation and is never implicit in a dashboard.
    recipientName: maskDisplayName(response.recipientName),
    submission: minimizeSubmission(response.submission, permissions),
    supportCase: minimizeSupportCase(response.supportCase, permissions),
  };
}

export function minimizeDashboard(
  dashboard: DashboardData,
  permissions: readonly AdminMembershipPermission[],
): DashboardData {
  return {
    ...dashboard,
    responses: dashboard.responses.map((response) =>
      minimizeDashboardResponse(response, permissions),
    ),
    supportCases: dashboard.supportCases.map(
      (supportCase) => minimizeSupportCase(supportCase, permissions)!,
    ),
  };
}
