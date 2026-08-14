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
  slotId: z.uuid().optional(),
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
      !(await isPublicLeadRequestAllowed(
        request,
        "/api/leads/viewing-request",
        10,
      ))
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
        "유효하지 않은 방문 요청입니다.",
        403,
      );
    }
    const lead = await (
      await getLeadRepository()
    ).requestViewing(leadId, parsed.data.listingId, parsed.data.slotId);
    if (!lead)
      return publicErrorResponse(
        responseContext,
        "NOT_FOUND",
        "문의를 찾을 수 없습니다.",
        404,
      );
    return jsonResponse(responseContext, { ok: true, status: lead.status });
  } catch (error) {
    const unavailable =
      error instanceof Error &&
      error.message.includes("VIEWING_SLOT_UNAVAILABLE");
    if (unavailable) {
      return publicErrorResponse(
        responseContext,
        "SLOT_UNAVAILABLE",
        "방금 다른 고객이 선택한 시간입니다. 다른 시간을 골라 주세요.",
        409,
      );
    }
    logSanitizedApiError(
      "public_viewing_request_failed",
      responseContext,
      error,
    );
    return publicErrorResponse(
      responseContext,
      "VIEWING_REQUEST_FAILED",
      "방문 요청을 저장하지 못했습니다.",
      500,
    );
  }
}
