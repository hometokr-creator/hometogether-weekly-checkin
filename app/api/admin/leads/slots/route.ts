import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdminAal2 } from "@/lib/auth/admin";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slotSchema = z
  .object({
    listingId: z.uuid(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    notes: z.string().trim().max(500).optional(),
    hostProfileId: z.uuid().optional(),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "종료 시간은 시작 시간보다 늦어야 합니다.",
  });

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request))
    return publicErrorResponse(
      context,
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403,
    );
  try {
    const admin = await requireAdminAal2("LEAD_WRITE");
    if (!admin.userId)
      return publicErrorResponse(
        context,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    const parsed = slotSchema.safeParse(await request.json());
    if (!parsed.success)
      return publicErrorResponse(
        context,
        "INVALID_BODY",
        "방문 시간 입력값을 확인해 주세요.",
        400,
      );
    const slot = await (
      await getLeadRepository()
    ).createViewingSlot(parsed.data, admin.userId);
    return jsonResponse(context, { ok: true, slot }, 201);
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    logSanitizedApiError("admin_viewing_slot_create_failed", context, error);
    return publicErrorResponse(
      context,
      "VIEWING_SLOT_CREATE_FAILED",
      "방문 가능 시간을 저장하지 못했습니다.",
      500,
    );
  }
}
