import { z } from "zod";

import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ listingId: string }> },
) {
  const responseContext = createRequestContext({ pragma: "no-cache" });
  const { listingId } = await context.params;
  if (!z.uuid().safeParse(listingId).success) {
    return publicErrorResponse(
      responseContext,
      "INVALID_LISTING",
      "매물 식별자를 확인해 주세요.",
      400,
    );
  }
  try {
    const from = new URL(request.url).searchParams.get("from") ?? undefined;
    const slots = await (
      await getLeadRepository()
    ).listAvailableSlots(listingId, from);
    return jsonResponse(responseContext, {
      slots: slots.map((slot) => ({
        id: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      })),
    });
  } catch (error) {
    logSanitizedApiError("public_viewing_slots_failed", responseContext, error);
    return publicErrorResponse(
      responseContext,
      "VIEWING_SLOTS_FAILED",
      "방문 가능 시간을 불러오지 못했습니다.",
      500,
    );
  }
}
