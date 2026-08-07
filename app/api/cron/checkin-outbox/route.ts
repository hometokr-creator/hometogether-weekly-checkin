import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import {
  recordCronExecution,
  recordCronFailureSafely,
} from "@/lib/auth/cron-execution";
import { isAuthorizedCronRequest } from "@/lib/jobs/cron-auth";
import { dispatchIntegrationOutbox } from "@/lib/webhooks/dispatch-outbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resultCount(
  value: unknown,
  key: "claimed" | "delivered" | "failed",
): number {
  if (!value || typeof value !== "object" || !(key in value)) return 0;
  const count = (value as Record<string, unknown>)[key];
  return typeof count === "number" && Number.isFinite(count)
    ? Math.max(0, count)
    : 0;
}

export async function GET(request: Request) {
  const context = createRequestContext();
  if (!isAuthorizedCronRequest(request)) {
    return publicErrorResponse(context, "UNAUTHORIZED", "인증되지 않은 작업입니다.", 401);
  }
  try {
    await recordCronExecution({
      requestId: context.requestId,
      jobName: "CHECKIN_OUTBOX",
      status: "STARTED",
    });
    const result = await dispatchIntegrationOutbox();
    const targetCount =
      resultCount(result.crm, "claimed") +
      resultCount(result.adminAlert, "claimed");
    const sentCount =
      resultCount(result.crm, "delivered") +
      resultCount(result.adminAlert, "delivered");
    const failedCount =
      resultCount(result.crm, "failed") +
      resultCount(result.adminAlert, "failed");
    await recordCronExecution({
      requestId: context.requestId,
      jobName: "CHECKIN_OUTBOX",
      status: "COMPLETED",
      targetCount,
      sentCount,
      failedCount,
    });
    return jsonResponse(context, { ok: true, ...result });
  } catch (error) {
    await recordCronFailureSafely(
      { requestId: context.requestId, jobName: "CHECKIN_OUTBOX" },
      error,
    );
    logSanitizedApiError("weekly_checkin_outbox_cron_failed", context, error);
    return publicErrorResponse(
      context,
      "CRON_FAILED",
      "외부 연동 작업을 완료하지 못했습니다.",
      500,
    );
  }
}
