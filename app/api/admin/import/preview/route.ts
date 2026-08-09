import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import {
  importFieldNames,
  type ImportColumnMapping,
} from "@/lib/imports/contracts";
import { CsvParseError } from "@/lib/imports/csv";
import { requireImportSuperAdmin } from "@/lib/imports/admin-authorization";
import { previewOperationalDataImport } from "@/lib/imports/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  csv: z.string().min(1).max(2_000_000),
  mapping: z.record(z.string(), z.string().max(255)),
});

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
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_500_000) {
    return publicErrorResponse(context, "PAYLOAD_TOO_LARGE", "CSV 파일은 2MB 이하여야 합니다.", 413);
  }

  try {
    await requireImportSuperAdmin();
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return publicErrorResponse(context, "INVALID_BODY", "CSV와 컬럼 연결을 확인해 주세요.", 400);
    }
    const mapping = parseMapping(parsed.data.mapping);
    if (!mapping) {
      return publicErrorResponse(context, "INVALID_MAPPING", "허용되지 않은 컬럼 연결입니다.", 400);
    }
    const plan = await previewOperationalDataImport({ csv: parsed.data.csv, mapping });
    return jsonResponse(context, {
      plan: {
        fileSha256: plan.fileSha256,
        planSha256: plan.planSha256,
        counts: plan.counts,
        issues: plan.issues.slice(0, 500),
        previewRows: plan.previewRows,
        canApply: plan.canApply,
      },
    });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    if (error instanceof CsvParseError) {
      return publicErrorResponse(context, "INVALID_CSV", error.message, 400);
    }
    logSanitizedApiError("admin_operational_import_preview_failed", context, error);
    return publicErrorResponse(context, "IMPORT_PREVIEW_FAILED", "CSV 검증을 완료하지 못했습니다.", 500);
  }
}
