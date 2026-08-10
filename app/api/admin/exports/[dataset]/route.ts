import "server-only";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import {
  AdminAuthorizationError,
  hasAdminPermission,
  requireAdminAal2,
} from "@/lib/auth/admin";
import { isCsvDataset, parseCsvExportFilters } from "@/lib/admin/csv";
import {
  createCsvExport,
  recordCsvExportAudit,
  requiredPermissionsForCsv,
} from "@/lib/admin/exports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const context = createRequestContext({ pragma: "no-cache" });
  const { dataset } = await params;
  if (!isCsvDataset(dataset)) {
    return publicErrorResponse(context, "EXPORT_NOT_FOUND", "지원하지 않는 CSV 종류입니다.", 404);
  }

  try {
    const requiredPermissions = requiredPermissionsForCsv(dataset);
    const admin = await requireAdminAal2(requiredPermissions[0]);
    if (
      !requiredPermissions.every((permission) =>
        hasAdminPermission(admin.permissions, permission),
      )
    ) {
      throw new AdminAuthorizationError("FORBIDDEN");
    }
    if (!admin.userId) {
      return publicErrorResponse(
        context,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "감사 로그를 위해 실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    }
    const filters = parseCsvExportFilters(new URL(request.url));
    const exported = await createCsvExport(dataset, filters);
    await recordCsvExportAudit(admin.userId, dataset, filters, exported.rowCount);

    return new Response(exported.body, {
      status: 200,
      headers: {
        ...context.headers,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const authorizationResponse = adminAuthorizationErrorResponse(context, error);
    if (authorizationResponse) return authorizationResponse;
    logSanitizedApiError("admin_csv_export_failed", context, error);
    return publicErrorResponse(
      context,
      "CSV_EXPORT_FAILED",
      "CSV 다운로드를 생성하지 못했습니다.",
      500,
    );
  }
}
