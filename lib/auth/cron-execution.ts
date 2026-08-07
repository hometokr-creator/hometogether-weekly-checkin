import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type CronJobName =
  | "WEEKLY_CHECKINS"
  | "CHECKIN_REMINDERS"
  | "CHECKIN_OUTBOX";
export type CronExecutionStatus = "STARTED" | "COMPLETED" | "FAILED";

export type CronExecutionRecord = {
  requestId: string;
  jobName: CronJobName;
  status: CronExecutionStatus;
  targetCount?: number;
  sentCount?: number;
  failedCount?: number;
  errorCode?: string | null;
};

function nonNegativeInteger(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value ?? 0));
}

export function safeCronErrorCode(error: unknown): string {
  const possibleCode =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  const value =
    typeof possibleCode === "string"
      ? possibleCode
      : error instanceof Error
        ? error.name
        : "UNKNOWN_ERROR";

  // Codes are operational labels only: never persist a provider/DB message,
  // URL, token, phone number, answer, or stack trace.
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value)
    ? value
    : "UNCLASSIFIED_ERROR";
}

export async function recordCronExecution(
  record: CronExecutionRecord,
): Promise<void> {
  const { error } = await createAdminClient().rpc("record_cron_execution", {
    p_request_id: record.requestId,
    p_job_name: record.jobName,
    p_status: record.status,
    p_target_count: nonNegativeInteger(record.targetCount),
    p_sent_count: nonNegativeInteger(record.sentCount),
    p_failed_count: nonNegativeInteger(record.failedCount),
    p_error_code: record.errorCode?.slice(0, 80) ?? null,
  });
  if (error) throw error;
}

export async function recordCronFailureSafely(
  record: Omit<CronExecutionRecord, "status">,
  originalError: unknown,
): Promise<void> {
  try {
    await recordCronExecution({
      ...record,
      status: "FAILED",
      failedCount: Math.max(1, record.failedCount ?? 0),
      errorCode: safeCronErrorCode(originalError),
    });
  } catch (recordingError) {
    console.error(
      JSON.stringify({
        event: "cron_execution_failure_record_failed",
        requestId: record.requestId,
        jobName: record.jobName,
        errorName:
          recordingError instanceof Error
            ? recordingError.name.slice(0, 80)
            : "UnknownError",
      }),
    );
  }
}
