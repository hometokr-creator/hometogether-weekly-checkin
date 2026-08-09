import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { AdminAuthorizationError, requireAdmin } from "@/lib/auth/admin";
import {
  getAlimtalkRuntimeConfig,
  getMessageQueueProvider,
  getMessagingConfigurationStatus,
  getPublicCheckinBaseUrl,
} from "@/lib/messaging/config";
import {
  normalizeKoreanMobilePhone,
  weeklyCheckinTemplateVariablesSchema,
} from "@/lib/messaging/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({ phone: z.string().trim().min(10).max(24) }).strict();

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.", 413);
  }

  try {
    const admin = await requireAdmin("CHECKIN_READ");
    if (!admin.permissions.includes("SUPER_ADMIN") || !admin.userId) {
      throw new AdminAuthorizationError("FORBIDDEN");
    }
    const configuration = getMessagingConfigurationStatus();
    if (!configuration.readyForAdminTest) {
      return publicErrorResponse(
        context,
        "ALIMTALK_NOT_CONFIGURED",
        "알림톡 Production 자격증명과 승인 템플릿이 모두 설정되어야 합니다.",
        503,
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return publicErrorResponse(context, "INVALID_BODY", "전화번호를 확인해 주세요.", 400);
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return publicErrorResponse(context, "INVALID_BODY", "전화번호를 확인해 주세요.", 400);
    }
    const phone = normalizeKoreanMobilePhone(parsed.data.phone);
    if (!phone) {
      return publicErrorResponse(
        context,
        "INVALID_PHONE",
        "010으로 시작하는 국내 휴대전화번호를 입력해 주세요.",
        400,
      );
    }

    const runtimeConfig = getAlimtalkRuntimeConfig();
    const variables = weeklyCheckinTemplateVariablesSchema.parse({
      name: "홈투게더 관리자",
      counterpartLabel: "공동생활 상대방",
      period: "알림톡 발송 테스트",
      deadline: "테스트 발송 후 확인",
      checkinUrl: `${getPublicCheckinBaseUrl()}/privacy/checkin`,
    });
    const { data, error } = await createAdminClient().rpc("enqueue_admin_alimtalk_test", {
      p_admin_id: admin.userId,
      p_provider: getMessageQueueProvider(),
      p_recipient_phone: phone,
      p_template_code: runtimeConfig.templateCode,
      p_template_variables: variables,
    });
    if (error) throw error;
    const messageRow = Array.isArray(data) ? data[0] : data;
    if (!messageRow) throw new Error("ALIMTALK_TEST_OUTBOX_ROW_MISSING");

    return jsonResponse(
      context,
      {
        ok: true,
        messageId: messageRow.id,
        status: messageRow.status,
        message: "알림톡 테스트 1건을 안전한 outbox에 등록했습니다.",
      },
      202,
    );
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    logSanitizedApiError("admin_alimtalk_test_enqueue_failed", context, error);
    return publicErrorResponse(
      context,
      "ALIMTALK_TEST_FAILED",
      "알림톡 테스트를 등록하지 못했습니다.",
      500,
    );
  }
}
