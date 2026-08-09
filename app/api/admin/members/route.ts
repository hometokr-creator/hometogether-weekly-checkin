import "server-only";

import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
  type RequestContext,
} from "@/app/api/_shared/responses";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminEmailConfigurationSummary } from "@/lib/auth/admin-config";
import {
  findVerifiedAuthUserByEmail,
  listAdminMembers,
  setAdminMembership,
} from "@/lib/auth/admin-members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const permissionSchema = z.enum([
  "CHECKIN_READ",
  "SAFETY_READ",
  "CASE_WRITE",
  "SUPER_ADMIN",
]);

const addAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  permissions: z.array(permissionSchema).min(1).max(4).transform((items) => [...new Set(items)]),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function errorResponse(context: RequestContext, error: unknown) {
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

  logSanitizedApiError("admin_members_api_failed", context, error);
  return publicErrorResponse(
    context,
    "ADMIN_MEMBERS_FAILED",
    "관리자 정보를 처리하지 못했습니다.",
    500,
  );
}

export async function GET() {
  const context = createRequestContext({ pragma: "no-cache" });
  try {
    await requireAdmin("SUPER_ADMIN");
    const members = await listAdminMembers();
    const emailConfiguration = getAdminEmailConfigurationSummary();
    return jsonResponse(context, {
      members,
      configuredEmailCount: emailConfiguration.count,
      configuredEmailListValid: emailConfiguration.valid,
    });
  } catch (error) {
    return errorResponse(context, error);
  }
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.", 413);
  }

  try {
    const admin = await requireAdmin("SUPER_ADMIN");
    if (!admin.userId) {
      return publicErrorResponse(
        context,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    }
    const parsed = addAdminSchema.safeParse(await request.json());
    if (!parsed.success) {
      return publicErrorResponse(context, "INVALID_BODY", "관리자 입력값을 확인해 주세요.", 400);
    }

    const target = await findVerifiedAuthUserByEmail(parsed.data.email);
    if (target.status === "NOT_FOUND") {
      return publicErrorResponse(
        context,
        "AUTH_USER_NOT_FOUND",
        "먼저 Supabase Auth에 가입하고 이메일 인증을 완료한 계정만 추가할 수 있습니다.",
        404,
      );
    }
    if (target.status === "UNVERIFIED") {
      return publicErrorResponse(
        context,
        "AUTH_USER_NOT_VERIFIED",
        "이메일 인증을 완료한 계정만 관리자로 추가할 수 있습니다.",
        409,
      );
    }

    await setAdminMembership(admin.userId, target.user.id, {
      permissions: parsed.data.permissions,
      isActive: true,
    });

    return jsonResponse(context, { ok: true, userId: target.user.id }, 201);
  } catch (error) {
    return errorResponse(context, error);
  }
}
