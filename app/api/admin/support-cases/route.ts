import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
  type RequestContext,
} from "@/app/api/_shared/responses";
import {
  requireAdmin,
} from "@/lib/auth/admin";
import type { SupportCaseActionInput } from "@/lib/checkin/repository";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const developmentAdminId = "00000000-0000-0000-0000-000000000000";

const updateCaseSchema = z.object({
  caseId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/),
  action: z.enum([
    "ACKNOWLEDGE",
    "ASSIGN",
    "KAKAO_PLANNED",
    "PHONE_COMPLETED",
    "RULE_GUIDANCE",
    "START_MEDIATION",
    "CONTRACT_CONSULT",
    "MONITOR",
    "RESOLVE",
    "CLOSE",
  ]),
  assignedAdminId: z.string().uuid().optional(),
  resolutionCode: z.string().trim().max(80).optional(),
  internalNote: z.string().trim().max(1000).optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function errorResponse(context: RequestContext, error: unknown) {
  const authorizationResponse = adminAuthorizationErrorResponse(context, error);
  if (authorizationResponse) return authorizationResponse;

  const message = error instanceof Error ? error.message : "";
  if (message.includes("not_found")) {
    return publicErrorResponse(context, "NOT_FOUND", "지원 사건을 찾을 수 없습니다.", 404);
  }
  if (message.includes("forbidden")) {
    return publicErrorResponse(context, "FORBIDDEN", "사건을 변경할 권한이 없습니다.", 403);
  }
  if (message.includes("invalid_")) {
    return publicErrorResponse(context, "INVALID_ACTION", "사건 조치 값을 확인해 주세요.", 400);
  }

  logSanitizedApiError("admin_support_case_api_failed", context, error);
  return publicErrorResponse(context, "UPDATE_FAILED", "사건 조치를 저장하지 못했습니다.", 500);
}

export async function GET() {
  const context = createRequestContext({ pragma: "no-cache" });
  try {
    await requireAdmin("SAFETY_READ");
    const dashboard = await (await getCheckinRepository()).getDashboard();

    return jsonResponse(context, { supportCases: dashboard.supportCases });
  } catch (error) {
    return errorResponse(context, error);
  }
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "관리자 메모 크기가 너무 큽니다.", 413);
  }

  try {
    const admin = await requireAdmin("CASE_WRITE");
    const parsed = updateCaseSchema.safeParse(await request.json());

    if (!parsed.success) {
      return publicErrorResponse(context, "INVALID_BODY", "사건 조치 입력값을 확인해 주세요.", 400);
    }

    const adminId = admin.userId ?? developmentAdminId;
    const input: SupportCaseActionInput = {
      action: parsed.data.action,
      assignedAdminId:
        parsed.data.action === "ASSIGN"
          ? parsed.data.assignedAdminId ?? adminId
          : parsed.data.assignedAdminId,
      resolutionCode: parsed.data.resolutionCode || undefined,
      internalNote: parsed.data.internalNote || undefined,
    };
    const supportCase = await (
      await getCheckinRepository()
    ).updateSupportCase(parsed.data.caseId, adminId, input);

    if (!supportCase) {
      return publicErrorResponse(context, "NOT_FOUND", "지원 사건을 찾을 수 없습니다.", 404);
    }

    return jsonResponse(
      context,
      {
        ok: true,
        supportCase: {
          id: supportCase.id,
          status: supportCase.status,
          acknowledgementAt: supportCase.acknowledgementAt,
          assignedAdminId: supportCase.assignedAdminId,
        },
      },
    );
  } catch (error) {
    return errorResponse(context, error);
  }
}
