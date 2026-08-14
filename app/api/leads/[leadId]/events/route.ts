import { z } from "zod";

import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { verifyPublicLeadToken } from "@/lib/leads/public-token";
import { isPublicLeadRequestAllowed } from "@/lib/leads/rate-limit";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  leadToken: z.string().min(20).max(1_000),
  listingId: z.uuid(),
  eventType: z.enum(["IMPRESSION", "CLICK"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ leadId: string }> },
) {
  const responseContext = createRequestContext({ pragma: "no-cache" });
  const { leadId } = await context.params;
  if (!z.uuid().safeParse(leadId).success) {
    return publicErrorResponse(
      responseContext,
      "INVALID_LEAD",
      "문의 식별자를 확인해 주세요.",
      400,
    );
  }
  try {
    if (
      !(await isPublicLeadRequestAllowed(request, "/api/leads/events", 100))
    ) {
      return publicErrorResponse(
        responseContext,
        "RATE_LIMITED",
        "잠시 후 다시 시도해 주세요.",
        429,
      );
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (
      !parsed.success ||
      !verifyPublicLeadToken(parsed.data.leadToken, leadId)
    ) {
      return publicErrorResponse(
        responseContext,
        "FORBIDDEN",
        "유효하지 않은 문의 요청입니다.",
        403,
      );
    }
    await (
      await getLeadRepository()
    ).recordListingEvent(leadId, parsed.data.listingId, parsed.data.eventType);
    return jsonResponse(responseContext, { ok: true });
  } catch (error) {
    logSanitizedApiError("public_lead_event_failed", responseContext, error);
    return publicErrorResponse(
      responseContext,
      "LEAD_EVENT_FAILED",
      "이벤트를 기록하지 못했습니다.",
      500,
    );
  }
}
