import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import {
  hasOversizedDeclaredBody,
  readLimitedJson,
  RequestBodyTooLargeError,
} from "@/app/api/_shared/request-body";
import { requireImportSuperAdmin } from "@/lib/imports/admin-authorization";
import {
  importFieldNames,
  type ImportColumnMapping,
} from "@/lib/imports/contracts";
import { CsvParseError } from "@/lib/imports/csv";
import {
  applyOperationalDataImport,
  previewOperationalDataImport,
} from "@/lib/imports/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  csv: z.string().min(1).max(2_000_000),
  mapping: z.record(z.string(), z.string().max(255)),
  expectedPlanSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const MAX_IMPORT_REQUEST_BYTES = 2_500_000;

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
function parseMapping(value: Record<string, string>): ImportColumnMapping | null {
  if (Object.keys(value).some((key) => !(importFieldNames as readonly string[]).includes(key))) {
    return null;
  }
  return Object.fromEntries(importFieldNames.map((field) => [field, value[field] ?? ""])) as ImportColumnMapping;
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(context, "INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
  }
  if (hasOversizedDeclaredBody(request, MAX_IMPORT_REQUEST_BYTES)) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "CSV 파일은 2MB 이하여야 합니다.", 413);
  }
  try {
    const admin = await requireImportSuperAdmin();
    if (!admin.userId) {
      return publicErrorResponse(context, "IMPORT_ADMIN_REQUIRED", "실제 관리자 계정으로 로그인해 주세요.", 503);
    }
    let raw: unknown;
    try {
      raw = await readLimitedJson(request, MAX_IMPORT_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "CSV 파일은 2MB 이하여야 합니다.", 413);
      }
      return publicErrorResponse(context, "INVALID_BODY", "가져오기 확인값을 점검해 주세요.", 400);
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return publicErrorResponse(context, "INVALID_BODY", "가져오기 확인값을 점검해 주세요.", 400);
    }
    const mapping = parseMapping(parsed.data.mapping);
    if (!mapping) {
      return publicErrorResponse(context, "INVALID_MAPPING", "허용되지 않은 컬럼 연결입니다.", 400);
    }

    // Re-read Production state and rebuild the entire plan. The browser never
    // decides what is written, and a stale preview cannot be confirmed.
    const plan = await previewOperationalDataImport({ csv: parsed.data.csv, mapping });
    if (plan.planSha256 !== parsed.data.expectedPlanSha256) {
      return publicErrorResponse(
        context,
        "IMPORT_PLAN_CHANGED",
        "운영 데이터가 변경됐습니다. CSV를 다시 미리보기 해 주세요.",
        409,
      );
    }
    if (!plan.canApply) {
      return publicErrorResponse(context, "IMPORT_HAS_ERRORS", "오류를 모두 해결한 뒤 적용해 주세요.", 422);
    }

    const result = await applyOperationalDataImport({
      adminId: admin.userId,
      fileName: parsed.data.fileName,
      plan,
    });
    return jsonResponse(context, { ok: true, ...result }, result.alreadyApplied ? 200 : 201);
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    if (error instanceof CsvParseError) {
      return publicErrorResponse(context, "INVALID_CSV", error.message, 400);
    }
    logSanitizedApiError("admin_operational_import_confirm_failed", context, error);
    return publicErrorResponse(context, "IMPORT_APPLY_FAILED", "운영 데이터 적용에 실패했습니다.", 500);
  }
}
