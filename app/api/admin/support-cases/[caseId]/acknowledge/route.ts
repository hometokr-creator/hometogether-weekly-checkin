import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import {
  requireAdmin,
} from "@/lib/auth/admin";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const developmentAdminId = "00000000-0000-0000-0000-000000000000";
const validCaseId = /^[A-Za-z0-9-]{1,128}$/;

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }

  try {
    const admin = await requireAdmin("CASE_WRITE");
    const { caseId } = await params;

    if (!validCaseId.test(caseId)) {
      return publicErrorResponse(context, "NOT_FOUND", "지원 사건을 찾을 수 없습니다.", 404);
    }

    const supportCase = await (
      await getCheckinRepository()
    ).updateSupportCase(caseId, admin.userId ?? developmentAdminId, {
      action: "ACKNOWLEDGE",
    });

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
        },
      },
    );
  } catch (error) {
    const authorizationResponse = adminAuthorizationErrorResponse(context, error);
    if (authorizationResponse) return authorizationResponse;

    const message = error instanceof Error ? error.message : "";
    const status = message.includes("not_found") ? 404 : message.includes("forbidden") ? 403 : 500;
    if (status === 404) {
      return publicErrorResponse(context, "NOT_FOUND", "지원 사건을 찾을 수 없습니다.", 404);
    }
    if (status === 403) {
      return publicErrorResponse(context, "FORBIDDEN", "사건을 변경할 권한이 없습니다.", 403);
    }
    logSanitizedApiError("admin_support_case_acknowledge_failed", context, error);
    return publicErrorResponse(context, "UPDATE_FAILED", "확인 시각을 기록하지 못했습니다.", 500);
  }
}
