import "server-only";

import { randomUUID } from "node:crypto";

import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

type JsonRow = Record<string, unknown>;

export type CronRunSummary = {
  id: string;
  weekStart: string;
  weekEnd: string;
  databaseStatus: string;
  outcome: "SUCCEEDED" | "FAILED" | "PENDING" | "NO_TARGETS";
  targetCount: number;
  initialSentCount: number;
  reminderSentCount: number;
  failedCount: number;
  pendingCount: number;
  lastActivityAt: string;
};

export type CronExecutionSummary = {
  requestId: string;
  jobName: string;
  status: "STARTED" | "COMPLETED" | "FAILED";
  targetCount: number;
  sentCount: number;
  failedCount: number;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
};

export type CronOperationsResult = {
  configured: boolean;
  executions: CronExecutionSummary[];
  runs: CronRunSummary[];
  requestId?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Returns aggregate operational records only. No participant, phone, token,
 * answer, or safety text is selected into the administrator page.
 */
export async function getRecentCronOperations(): Promise<CronOperationsResult> {
  if (!isSupabaseAdminConfigured()) {
    return { configured: false, executions: [], runs: [] };
  }

  const requestId = randomUUID();
  try {
    const supabase = createAdminClient();
    const [executionResult, runResult] = await Promise.all([
      supabase
        .from("cron_execution_logs")
        .select(
          "request_id,job_name,status,target_count,sent_count,failed_count,error_code,started_at,finished_at,updated_at",
        )
        .order("started_at", { ascending: false })
        .limit(12),
      supabase
        .from("weekly_checkin_runs")
        .select("id,week_start,week_end,status,created_at,updated_at")
        .order("week_start", { ascending: false })
        .limit(5),
    ]);
    if (executionResult.error) throw executionResult.error;
    if (runResult.error) throw runResult.error;

    const executions = ((executionResult.data ?? []) as JsonRow[]).map(
      (row): CronExecutionSummary => ({
        requestId: stringValue(row.request_id),
        jobName: stringValue(row.job_name),
        status: stringValue(row.status) as CronExecutionSummary["status"],
        targetCount: Number(row.target_count) || 0,
        sentCount: Number(row.sent_count) || 0,
        failedCount: Number(row.failed_count) || 0,
        errorCode: stringValue(row.error_code) || undefined,
        startedAt: stringValue(row.started_at),
        finishedAt: stringValue(row.finished_at) || undefined,
        updatedAt: stringValue(row.updated_at),
      }),
    );

    const runs = (runResult.data ?? []) as JsonRow[];
    const runIds = runs.map((run) => stringValue(run.id)).filter(Boolean);
    if (!runIds.length) return { configured: true, executions, runs: [] };

    const { data: invitationData, error: invitationError } = await supabase
      .from("weekly_checkin_invitations")
      .select("id,run_id,status,updated_at")
      .in("run_id", runIds);
    if (invitationError) throw invitationError;

    const invitations = (invitationData ?? []) as JsonRow[];
    const invitationIds = invitations
      .map((invitation) => stringValue(invitation.id))
      .filter(Boolean);
    let messages: JsonRow[] = [];
    if (invitationIds.length) {
      const { data: messageData, error: messageError } = await supabase
        .from("message_logs")
        .select("invitation_id,message_type,status,updated_at")
        .in("invitation_id", invitationIds);
      if (messageError) throw messageError;
      messages = (messageData ?? []) as JsonRow[];
    }

    const invitationRunById = new Map(
      invitations.map((invitation) => [
        stringValue(invitation.id),
        stringValue(invitation.run_id),
      ]),
    );

    return {
      configured: true,
      executions,
      runs: runs.map((run) => {
        const runId = stringValue(run.id);
        const runInvitations = invitations.filter(
          (invitation) => stringValue(invitation.run_id) === runId,
        );
        const runMessages = messages.filter(
          (message) =>
            invitationRunById.get(stringValue(message.invitation_id)) === runId,
        );
        const initialMessages = runMessages.filter(
          (message) => message.message_type === "WEEKLY_CHECKIN",
        );
        const reminderMessages = runMessages.filter(
          (message) => message.message_type === "WEEKLY_CHECKIN_REMINDER",
        );
        const activityTimes = [
          stringValue(run.updated_at),
          ...runInvitations.map((row) => stringValue(row.updated_at)),
          ...runMessages.map((row) => stringValue(row.updated_at)),
        ].filter(Boolean);
        const initialSentCount = initialMessages.filter(
          (message) => message.status === "SENT",
        ).length;
        const failedCount = runMessages.filter(
          (message) => message.status === "FAILED",
        ).length;
        const pendingCount = runMessages.filter((message) =>
          ["PENDING", "SENDING", "RETRYABLE"].includes(
            stringValue(message.status),
          ),
        ).length;
        const databaseStatus = stringValue(run.status);
        const outcome =
          failedCount > 0 || ["FAILED", "PARTIAL_FAILED"].includes(databaseStatus)
            ? "FAILED"
            : pendingCount > 0
              ? "PENDING"
              : runInvitations.length === 0
                ? "NO_TARGETS"
                : initialSentCount >= runInvitations.length
                  ? "SUCCEEDED"
                  : "PENDING";

        return {
          id: runId,
          weekStart: stringValue(run.week_start),
          weekEnd: stringValue(run.week_end),
          databaseStatus,
          outcome,
          targetCount: runInvitations.length,
          initialSentCount,
          reminderSentCount: reminderMessages.filter(
            (message) => message.status === "SENT",
          ).length,
          failedCount,
          pendingCount,
          lastActivityAt: activityTimes.sort().at(-1) ?? stringValue(run.created_at),
        };
      }),
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "admin_cron_operations_read_failed",
        requestId,
        errorName: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      }),
    );
    return { configured: true, executions: [], runs: [], requestId };
  }
}
