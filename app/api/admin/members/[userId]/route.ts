import "server-only";

import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdminAal2 } from "@/lib/auth/admin";
import { setAdminMembership } from "@/lib/auth/admin-members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  permissions: z
    .array(z.enum([
      "CHECKIN_READ",
      "SAFETY_READ",
      "CONTACT_READ",
      "DATA_EXPORT",
      "CASE_WRITE",
      "SUPER_ADMIN",
    ]))
    .min(1)
    .max(6)
    .transform((items) => [...new Set(items)]),
  isActive: z.boolean(),
  reason: z.string().trim().min(1).max(500).optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.", 413);
  }

  try {
    const admin = await requireAdminAal2("SUPER_ADMIN");
    if (!admin.userId) {
      return publicErrorResponse(
        context,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    }
    const { userId } = await params;
    if (!z.string().uuid().safeParse(userId).success) {
      return publicErrorResponse(context, "INVALID_USER_ID", "관리자 ID를 확인해 주세요.", 400);
    }
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success || (!parsed.data.isActive && !parsed.data.reason)) {
      return publicErrorResponse(
        context,
        "INVALID_BODY",
        "비활성화 사유와 권한 입력값을 확인해 주세요.",
        400,
      );
    }

    await setAdminMembership(admin.userId, userId, parsed.data);
    return jsonResponse(context, { ok: true, userId });
  } catch (error) {
    const authorizationResponse = adminAuthorizationErrorResponse(context, error);
    if (authorizationResponse) return authorizationResponse;
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    const message = error instanceof Error ? error.message : "";
    if (code === "23514" || message.includes("last_super_admin_protected")) {
      return publicErrorResponse(
        context,
        "LAST_SUPER_ADMIN_PROTECTED",
        "마지막 최고 관리자는 비활성화하거나 권한을 낮출 수 없습니다.",
        409,
      );
    }
    logSanitizedApiError("admin_member_update_failed", context, error);
    return publicErrorResponse(
      context,
      "ADMIN_MEMBER_UPDATE_FAILED",
      "관리자 권한을 변경하지 못했습니다.",
      500,
    );
  }
}
