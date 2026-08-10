import "server-only";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAnyAdminWithMfa } from "@/lib/auth/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }

  try {
    const admin = await requireAnyAdminWithMfa();
    return jsonResponse(context, {
      ok: true,
      permissions: admin.permissions,
      mfa: admin.mfa,
    });
  } catch (error) {
    const authorizationResponse = adminAuthorizationErrorResponse(context, error);
    if (authorizationResponse) return authorizationResponse;
    logSanitizedApiError("admin_session_provision_failed", context, error);
    return publicErrorResponse(
      context,
      "SESSION_PROVISION_FAILED",
      "관리자 권한을 확인하지 못했습니다.",
      500,
    );
  }
}
