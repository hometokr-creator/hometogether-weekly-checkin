import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireImportSuperAdmin } from "@/lib/imports/admin-authorization";
import { importFieldNames } from "@/lib/imports/contracts";
import { csvCell } from "@/lib/imports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const context = createRequestContext({ pragma: "no-cache" });
  try {
    await requireImportSuperAdmin();
    const body = `\uFEFF${importFieldNames.map(csvCell).join(",")}\r\n`;
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="hometogether-operational-import-template.csv"',
        "cache-control": "private, no-store, max-age=0",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
        "x-request-id": context.requestId,
      },
    });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(context, error);
    if (authorization) return authorization;
    return publicErrorResponse(context, "TEMPLATE_FAILED", "CSV 양식을 만들지 못했습니다.", 500);
  }
}
