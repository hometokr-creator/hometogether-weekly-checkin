import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ResponseAccessClassification = "MISSING" | "ORDINARY" | "SAFETY";

export function responseRequiresSafetyPermission(options: {
  riskLevel: unknown;
  immediateDanger: unknown;
  safeToContact: unknown;
  safeLocation: unknown;
  hasSafetyIssue: boolean;
  hasSupportCase: boolean;
}): boolean {
  return (
    options.riskLevel === "RED" ||
    options.immediateDanger != null ||
    options.safeToContact != null ||
    options.safeLocation != null ||
    options.hasSafetyIssue ||
    options.hasSupportCase
  );
}

/**
 * Reads only authorization metadata after an active-admin guard. No answers,
 * names, contact fields, free text, or question snapshots are selected before
 * the route enforces CHECKIN_READ or SAFETY_READ.
 */
export async function classifyResponseAccess(
  responseId: string,
): Promise<ResponseAccessClassification> {
  const supabase = createAdminClient();
  const [responseResult, safetyIssueResult, supportCaseResult] = await Promise.all([
    supabase
      .from("weekly_checkin_responses")
      .select("risk_level,immediate_danger,safe_to_contact,safe_location")
      .eq("id", responseId)
      .maybeSingle(),
    supabase
      .from("weekly_checkin_issues")
      .select("id")
      .eq("response_id", responseId)
      .eq("category", "SAFETY")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("support_cases")
      .select("id")
      .eq("response_id", responseId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (responseResult.error) throw responseResult.error;
  if (safetyIssueResult.error) throw safetyIssueResult.error;
  if (supportCaseResult.error) throw supportCaseResult.error;
  if (!responseResult.data) return "MISSING";

  return responseRequiresSafetyPermission({
    riskLevel: responseResult.data.risk_level,
    immediateDanger: responseResult.data.immediate_danger,
    safeToContact: responseResult.data.safe_to_contact,
    safeLocation: responseResult.data.safe_location,
    hasSafetyIssue: Boolean(safetyIssueResult.data),
    hasSupportCase: Boolean(supportCaseResult.data),
  })
    ? "SAFETY"
    : "ORDINARY";
}
