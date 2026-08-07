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
import { createWeeklyCheckins } from "@/lib/jobs/create-weekly-checkins";
import { isAuthorizedCronRequest } from "@/lib/jobs/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const context = createRequestContext();
  if (!isAuthorizedCronRequest(request)) {
    return publicErrorResponse(context, "UNAUTHORIZED", "인증되지 않은 작업입니다.", 401);
  }
  try {
    await recordCronExecution({
      requestId: context.requestId,
      jobName: "WEEKLY_CHECKINS",
      status: "STARTED",
    });
    const summary = await createWeeklyCheckins();
    await recordCronExecution({
      requestId: context.requestId,
      jobName: "WEEKLY_CHECKINS",
      status: "COMPLETED",
      targetCount: summary.created,
      sentCount: summary.sent,
      failedCount: summary.failed,
    });
    return jsonResponse(context, { ok: true, ...summary });
  } catch (error) {
    await recordCronFailureSafely(
      { requestId: context.requestId, jobName: "WEEKLY_CHECKINS" },
      error,
    );
    logSanitizedApiError("weekly_checkin_cron_failed", context, error);
    return publicErrorResponse(
      context,
      "CRON_FAILED",
      "주간 체크인 작업을 완료하지 못했습니다.",
      500,
    );
  }
}
