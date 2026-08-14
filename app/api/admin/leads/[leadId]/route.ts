import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdmin, requireAdminAal2 } from "@/lib/auth/admin";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum([
    "RESPOND",
    "ASSIGN",
    "RECOMMEND_ALTERNATIVE",
    "REQUEST_VIEWING",
    "CONFIRM_VIEWING",
    "COMPLETE_VIEWING",
    "CANCEL_VIEWING",
    "CHURN",
    "REGISTER",
  ]),
  assignedAdminId: z.uuid().optional(),
  listingId: z.uuid().optional(),
  slotId: z.uuid().optional(),
  viewingEventId: z.uuid().optional(),
  viewingAt: z.iso.datetime().optional(),
  cancellationActor: z.enum(["CUSTOMER", "HOST", "ADMIN", "SYSTEM"]).optional(),
  cancellationReason: z.string().trim().max(1_000).optional(),
  churnStage: z
    .enum([
      "INQUIRY",
      "VIEWING_SCHEDULED",
      "AFTER_VIEWING",
      "AFTER_REGISTRATION",
    ])
    .optional(),
  churnReason: z
    .enum([
      "RESPONSE_DELAY",
      "LISTING_CONDITION",
      "LOCATION",
      "NO_INVENTORY",
      "CONTRACT_TERM",
      "PRICE",
      "DEPOSIT",
      "MOVE_IN_REGISTRATION",
      "KITCHEN",
      "CURFEW",
      "HOST_INFO",
      "FAMILY_OPPOSITION",
      "OTHER_PROPERTY",
      "PERSONAL_REASON",
      "UNKNOWN",
    ])
    .optional(),
  churnReasonNote: z.string().trim().max(2_000).optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function toActionInput(value: z.infer<typeof actionSchema>) {
  if (value.action === "RESPOND" || value.action === "REGISTER")
    return { action: value.action } as const;
  if (value.action === "ASSIGN")
    return {
      action: value.action,
      assignedAdminId: value.assignedAdminId,
    } as const;
  if (
    value.action === "RECOMMEND_ALTERNATIVE" ||
    value.action === "REQUEST_VIEWING"
  ) {
    if (!value.listingId) return null;
    return value.action === "RECOMMEND_ALTERNATIVE"
      ? ({ action: value.action, listingId: value.listingId } as const)
      : ({
          action: value.action,
          listingId: value.listingId,
          slotId: value.slotId,
        } as const);
  }
  if (
    value.action === "CONFIRM_VIEWING" ||
    value.action === "COMPLETE_VIEWING"
  ) {
    if (!value.viewingEventId) return null;
    return value.action === "CONFIRM_VIEWING"
      ? ({
          action: value.action,
          viewingEventId: value.viewingEventId,
        } as const)
      : ({
          action: value.action,
          viewingEventId: value.viewingEventId,
          viewingAt: value.viewingAt,
        } as const);
  }
  if (value.action === "CANCEL_VIEWING") {
    if (!value.viewingEventId || !value.cancellationActor) return null;
    return {
      action: value.action,
      viewingEventId: value.viewingEventId,
      cancellationActor: value.cancellationActor,
      cancellationReason: value.cancellationReason,
    } as const;
  }
  if (!value.churnStage || !value.churnReason) return null;
  return {
    action: "CHURN" as const,
    churnStage: value.churnStage,
    churnReason: value.churnReason,
    churnReasonNote: value.churnReasonNote,
  };
}

export async function GET(
  _request: Request,
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
    await requireAdmin("LEAD_READ");
    const lead = await (await getLeadRepository()).getLead(leadId);
    if (!lead)
      return publicErrorResponse(
        responseContext,
        "NOT_FOUND",
        "문의를 찾을 수 없습니다.",
        404,
      );
    return jsonResponse(responseContext, { lead });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(
      responseContext,
      error,
    );
    if (authorization) return authorization;
    logSanitizedApiError("admin_lead_get_failed", responseContext, error);
    return publicErrorResponse(
      responseContext,
      "LEAD_GET_FAILED",
      "문의를 불러오지 못했습니다.",
      500,
    );
  }
}

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
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(
      responseContext,
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403,
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return publicErrorResponse(
      responseContext,
      "PAYLOAD_TOO_LARGE",
      "조치 입력 크기가 너무 큽니다.",
      413,
    );
  }
  try {
    const admin = await requireAdminAal2("LEAD_WRITE");
    if (!admin.userId) {
      return publicErrorResponse(
        responseContext,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    }
    const parsed = actionSchema.safeParse(await request.json());
    const action = parsed.success ? toActionInput(parsed.data) : null;
    if (!action)
      return publicErrorResponse(
        responseContext,
        "INVALID_BODY",
        "조치 입력값을 확인해 주세요.",
        400,
      );
    const lead = await (
      await getLeadRepository()
    ).updateLead(leadId, admin.userId, action);
    if (!lead)
      return publicErrorResponse(
        responseContext,
        "NOT_FOUND",
        "문의를 찾을 수 없습니다.",
        404,
      );
    return jsonResponse(responseContext, { ok: true, lead });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(
      responseContext,
      error,
    );
    if (authorization) return authorization;
    logSanitizedApiError("admin_lead_action_failed", responseContext, error);
    return publicErrorResponse(
      responseContext,
      "LEAD_ACTION_FAILED",
      "문의 조치를 저장하지 못했습니다.",
      500,
    );
  }
}
