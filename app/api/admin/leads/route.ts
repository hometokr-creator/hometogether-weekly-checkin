import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdmin } from "@/lib/auth/admin";
import { getLeadRepository } from "@/lib/leads/repository-factory";
import type { LeadFilters } from "@/lib/leads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function first(searchParams: URLSearchParams, key: string): string | undefined {
  return searchParams.get(key)?.trim() || undefined;
}

function filtersFromRequest(request: Request): LeadFilters {
  const searchParams = new URL(request.url).searchParams;
  return {
    from: first(searchParams, "from"),
    to: first(searchParams, "to"),
    source: first(searchParams, "source") as LeadFilters["source"],
    customerType: first(
      searchParams,
      "customerType",
    ) as LeadFilters["customerType"],
    region: first(searchParams, "region"),
    term: first(searchParams, "term") as LeadFilters["term"],
    stage: first(searchParams, "stage") as LeadFilters["stage"],
    outcome: first(searchParams, "outcome") as LeadFilters["outcome"],
    churnReason: first(
      searchParams,
      "churnReason",
    ) as LeadFilters["churnReason"],
    assignedAdminId: first(searchParams, "assignedAdminId"),
  };
}

export async function GET(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  try {
    await requireAdmin("LEAD_READ");
    const dashboard = await (
      await getLeadRepository()
    ).getDashboard(filtersFromRequest(request));
    return jsonResponse(context, dashboard);
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    logSanitizedApiError("admin_leads_list_failed", context, error);
    return publicErrorResponse(
      context,
      "LEADS_LIST_FAILED",
      "문의 목록을 불러오지 못했습니다.",
      500,
    );
  }
}
