import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdminAal2 } from "@/lib/auth/admin";
import { LeadCsvError, parseLeadImportCsv } from "@/lib/leads/import";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sourceSystem: z.string().trim().min(1).max(80),
  csv: z.string().min(1).max(1_500_000),
  confirm: z.boolean().optional(),
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
    const admin = await requireAdminAal2("LEAD_IMPORT");
    if (!admin.userId)
      return publicErrorResponse(
        context,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success)
      return publicErrorResponse(
        context,
        "INVALID_BODY",
        "CSV 입력값을 확인해 주세요.",
        400,
      );
    const preview = parseLeadImportCsv(parsed.data.csv);
    if (!parsed.data.confirm) {
      return jsonResponse(context, {
        ok: true,
        preview: {
          fileSha256: preview.fileSha256,
          totalRows: preview.rows.length,
          warnings: preview.warnings,
          records: preview.rows.slice(0, 20).map((row) => ({
            recordId: row.importRecordId,
            customerLabel: row.customerLabel ?? "식별자 없음",
            source: row.source,
            confidence: row.confidence,
          })),
        },
      });
    }
    const result = await (
      await getLeadRepository()
    ).importLeads({
      adminId: admin.userId,
      fileName: parsed.data.fileName,
      fileSha256: preview.fileSha256,
      sourceSystem: parsed.data.sourceSystem,
      rows: preview.rows,
    });
    return jsonResponse(context, { ok: true, result });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    if (error instanceof LeadCsvError) {
      return publicErrorResponse(context, "INVALID_CSV", error.message, 400);
    }
    logSanitizedApiError("admin_lead_import_failed", context, error);
    return publicErrorResponse(
      context,
      "LEAD_IMPORT_FAILED",
      "CSV 가져오기를 완료하지 못했습니다.",
      500,
    );
  }
}
