import "server-only";

import { getAdminEmailConfigurationSummary } from "@/lib/auth/admin-config";
import {
  evaluateWeeklyEligibility,
  type EligibilityMatch,
  type EligibilityResult,
} from "@/lib/checkin/eligibility";
import { getMessagingConfigurationStatus } from "@/lib/messaging/config";
import { createAdminClient } from "@/lib/supabase/admin";

type JsonRow = Record<string, unknown>;

export type OperationalState = "OK" | "WARNING" | "ERROR" | "UNKNOWN";

export type AdminSystemStatus = {
  checkedAt: string;
  database: { state: OperationalState; connected: boolean; degraded: boolean };
  profiles: { total: number; activeHosts: number; activeGuests: number };
  homes: { active: number };
  matches: { active: number };
  weeklyCheckin: {
    weekStart: string;
    created: number;
    responses: number;
    responseRate: number;
    eligibleTargets: number;
    invalidPhone: number;
    notificationDisabled: number;
    multipleActiveMatches: number;
  };
  alimtalk: ReturnType<typeof getMessagingConfigurationStatus> & {
    recentSent: number;
    recentFailed: number;
    lastSentAt?: string;
    lastFailedAt?: string;
  };
  outbox: {
    pending: number;
    retry: number;
    failed: number;
    sentToday: number;
    nextDue: number;
  };
  cron: {
    secretConfigured: boolean;
    lastRunAt?: string;
    lastSuccessAt?: string;
    lastErrorCode?: string;
    nextDueCount: number;
  };
  admin: {
    activeCount: number;
    allowlistCount: number;
    allowlistValid: boolean;
  };
  backup: {
    plan: string;
    automatic: "ENABLED" | "DISABLED" | "UNKNOWN";
    pitr: "ENABLED" | "DISABLED" | "UNKNOWN";
  };
  domain: {
    hostname: "checkin.hometogether.kr";
    baseUrlConfigured: boolean;
    reachable: boolean;
  };
};

function koreanDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function currentKoreanWeekStart(now = new Date()): string {
  const date = koreanDate(now);
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const localEquivalent = new Date(Date.UTC(year, month - 1, dayOfMonth));
  const day = localEquivalent.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  localEquivalent.setUTCDate(localEquivalent.getUTCDate() - daysSinceMonday);
  return localEquivalent.toISOString().slice(0, 10);
}

function kstDayStartIso(now = new Date()): string {
  return `${koreanDate(now)}T00:00:00+09:00`;
}

function envManagedStatus(
  value: string | undefined,
): "ENABLED" | "DISABLED" | "UNKNOWN" {
  const normalized = value?.trim().toUpperCase();
  return normalized === "ENABLED" || normalized === "DISABLED"
    ? normalized
    : "UNKNOWN";
}

async function probeCustomDomain(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch("https://checkin.hometogether.kr", {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function configuredCustomDomain(): boolean {
  const value =
    process.env.PUBLIC_CHECKIN_BASE_URL ??
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL;
  if (!value) return false;
  try {
    return new URL(value).hostname === "checkin.hometogether.kr";
  } catch {
    return false;
  }
}

function successful<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

function first(value: unknown): JsonRow | undefined {
  if (Array.isArray(value)) return value[0] as JsonRow | undefined;
  return value && typeof value === "object" ? (value as JsonRow) : undefined;
}

function databaseStateFromSettled(
  core: readonly PromiseSettledResult<unknown>[],
  allDatabase: readonly PromiseSettledResult<unknown>[],
): AdminSystemStatus["database"] {
  const failedCoreQueries = core.filter((result) => result.status === "rejected").length;
  const connected = core.length > 0 && failedCoreQueries < core.length;
  const degraded = allDatabase.some((result) => result.status === "rejected");
  return {
    state: !connected ? "ERROR" : degraded ? "WARNING" : "OK",
    connected,
    degraded,
  };
}

function uniqueExcludedParticipants(
  result: EligibilityResult,
  code: EligibilityResult["excluded"][number]["code"],
): number {
  return new Set(
    result.excluded
      .filter((excluded) => excluded.code === code)
      .map((excluded) => excluded.participantId),
  ).size;
}

function mapEligibilityMatch(row: JsonRow): EligibilityMatch {
  const home = first(row.home);
  const host = first(row.host);
  const guest = first(row.guest);
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    moveInDate: String(row.move_in_date ?? ""),
    moveOutDate: typeof row.move_out_date === "string" ? row.move_out_date : null,
    contractEndDate:
      typeof row.contract_end_date === "string" ? row.contract_end_date : null,
    homeActive: home?.is_active === true,
    host: {
      id: String(row.host_id ?? ""),
      active: host?.is_active === true,
      notificationEnabled: host?.notification_enabled === true,
      phone: typeof host?.phone === "string" ? host.phone : null,
    },
    guest: {
      id: String(row.guest_id ?? ""),
      active: guest?.is_active === true,
      notificationEnabled: guest?.notification_enabled === true,
      phone: typeof guest?.phone === "string" ? guest.phone : null,
    },
  };
}

async function rows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<JsonRow[]> {
  const result = await query;
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? (result.data as JsonRow[]) : [];
}

async function count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const result = await query;
  if (result.error) throw result.error;
  return result.count ?? 0;
}

/**
 * Returns aggregate operational state only. Raw phone values are read solely
 * to validate eligibility and are never returned, logged, or rendered. Tokens,
 * answers, secrets, and provider error text are not selected.
 */
export async function getAdminSystemStatus(adminId: string): Promise<AdminSystemStatus> {
  const supabase = createAdminClient();
  const { data: allowed, error: permissionError } = await supabase.rpc(
    "admin_has_permission",
    { p_user_id: adminId, p_required_permission: "CHECKIN_READ" },
  );
  if (permissionError || allowed !== true) throw permissionError ?? new Error("ADMIN_FORBIDDEN");

  const today = koreanDate();
  const weekStart = currentKoreanWeekStart();
  const startOfToday = kstDayStartIso();
  const nowIso = new Date().toISOString();
  const queries = await Promise.allSettled([
    count(supabase.from("profiles").select("id", { count: "exact", head: true })),
    count(
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("profile_type", "HOST")
        .eq("is_active", true),
    ),
    count(
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("profile_type", "GUEST")
        .eq("is_active", true),
    ),
    count(
      supabase
        .from("homes")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
    ),
    rows(
      supabase
        .from("matches")
        .select(
          "id,host_id,guest_id,status,move_in_date,move_out_date,contract_end_date,home:homes!matches_home_id_fkey(is_active),host:profiles!matches_host_id_fkey(is_active,notification_enabled,phone),guest:profiles!matches_guest_id_fkey(is_active,notification_enabled,phone)",
        )
        .eq("status", "ACTIVE"),
    ),
    rows(
      supabase
        .from("weekly_checkin_admin_run_stats")
        .select("week_start,target_count,completed_count")
        .eq("week_start", weekStart)
        .limit(1),
    ),
    rows(
      supabase
        .from("weekly_checkin_invitations")
        .select("participant_id,run:weekly_checkin_runs!inner(week_start)")
        .eq("run.week_start", weekStart)
        .eq("is_test", false),
    ),
    rows(
      supabase
        .from("message_logs")
        .select("status,provider,sent_at,created_at,next_attempt_at,delivery_scope")
        .order("created_at", { ascending: false })
        .limit(5000),
    ),
    rows(
      supabase
        .from("cron_execution_logs")
        .select("status,started_at,finished_at,error_code")
        .order("started_at", { ascending: false })
        .limit(100),
    ),
    count(
      supabase
        .from("admin_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("is_active", true),
    ),
    probeCustomDomain(),
  ]);

  const coreQueries = queries.slice(0, 6);
  const database = databaseStateFromSettled(coreQueries, queries.slice(0, 10));
  const profileTotal = successful(queries[0] as PromiseSettledResult<number>, 0);
  const activeHosts = successful(queries[1] as PromiseSettledResult<number>, 0);
  const activeGuests = successful(queries[2] as PromiseSettledResult<number>, 0);
  const activeHomes = successful(queries[3] as PromiseSettledResult<number>, 0);
  const matchRows = successful(queries[4] as PromiseSettledResult<JsonRow[]>, []);
  const runRows = successful(queries[5] as PromiseSettledResult<JsonRow[]>, []);
  const existingInvitationRows = successful(
    queries[6] as PromiseSettledResult<JsonRow[]>,
    [],
  );
  const messageRows = successful(queries[7] as PromiseSettledResult<JsonRow[]>, []);
  const cronRows = successful(queries[8] as PromiseSettledResult<JsonRow[]>, []);
  const activeAdmins = successful(queries[9] as PromiseSettledResult<number>, 0);
  const domainReachable = successful(queries[10] as PromiseSettledResult<boolean>, false);

  const run = runRows[0];
  const created = Number(run?.target_count ?? 0) || 0;
  const responses = Number(run?.completed_count ?? 0) || 0;
  const productionMessages = messageRows.filter((row) => row.delivery_scope !== "ADMIN_TEST");
  const providerMessages = productionMessages.filter(
    (row) => String(row.provider ?? "").toLowerCase() !== "mock",
  );
  const sentMessages = providerMessages.filter((row) => row.status === "SENT");
  const failedMessages = providerMessages.filter((row) => row.status === "FAILED");
  const dueMessages = productionMessages.filter(
    (row) =>
      ["PENDING", "RETRYABLE"].includes(String(row.status ?? "")) &&
      (!row.next_attempt_at || String(row.next_attempt_at) <= nowIso),
  );
  const lastSuccess = cronRows.find((row) => row.status === "COMPLETED");
  const lastFailure = cronRows.find((row) => row.status === "FAILED");
  const messaging = getMessagingConfigurationStatus();
  const adminEmails = getAdminEmailConfigurationSummary();
  const eligibility = evaluateWeeklyEligibility({
    matches: matchRows.map(mapEligibilityMatch),
    asOfDate: today,
    alreadyCreatedParticipantIds: new Set(
      existingInvitationRows
        .map((row) => row.participant_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  });

  return {
    checkedAt: new Date().toISOString(),
    database,
    profiles: { total: profileTotal, activeHosts, activeGuests },
    homes: { active: activeHomes },
    matches: { active: matchRows.length },
    weeklyCheckin: {
      weekStart,
      created,
      responses,
      responseRate: created ? Math.round((responses / created) * 100) : 0,
      eligibleTargets: eligibility.eligible.length,
      invalidPhone: uniqueExcludedParticipants(eligibility, "PHONE_INVALID"),
      notificationDisabled: uniqueExcludedParticipants(
        eligibility,
        "NOTIFICATION_DISABLED",
      ),
      multipleActiveMatches: uniqueExcludedParticipants(
        eligibility,
        "MULTIPLE_ACTIVE_MATCHES",
      ),
    },
    alimtalk: {
      ...messaging,
      recentSent: sentMessages.length,
      recentFailed: failedMessages.length,
      lastSentAt:
        sentMessages.find((row) => typeof row.sent_at === "string")?.sent_at as
          | string
          | undefined,
      lastFailedAt:
        failedMessages.find((row) => typeof row.created_at === "string")?.created_at as
          | string
          | undefined,
    },
    outbox: {
      pending: productionMessages.filter((row) => row.status === "PENDING").length,
      retry: productionMessages.filter((row) => row.status === "RETRYABLE").length,
      failed: productionMessages.filter((row) => row.status === "FAILED").length,
      sentToday: productionMessages.filter(
        (row) => row.status === "SENT" && String(row.sent_at ?? "") >= startOfToday,
      ).length,
      nextDue: dueMessages.length,
    },
    cron: {
      secretConfigured: (process.env.CRON_SECRET?.length ?? 0) >= 16,
      lastRunAt: typeof cronRows[0]?.started_at === "string" ? cronRows[0].started_at : undefined,
      lastSuccessAt:
        typeof lastSuccess?.finished_at === "string" ? lastSuccess.finished_at : undefined,
      lastErrorCode:
        typeof lastFailure?.error_code === "string" ? lastFailure.error_code : undefined,
      nextDueCount: dueMessages.length,
    },
    admin: {
      activeCount: activeAdmins,
      allowlistCount: adminEmails.count,
      allowlistValid: adminEmails.valid,
    },
    backup: {
      plan: process.env.SUPABASE_PLAN?.trim() || "UNKNOWN",
      automatic: envManagedStatus(process.env.SUPABASE_BACKUP_STATUS),
      pitr: envManagedStatus(process.env.SUPABASE_PITR_STATUS),
    },
    domain: {
      hostname: "checkin.hometogether.kr",
      baseUrlConfigured: configuredCustomDomain(),
      reachable: domainReachable,
    },
  };
}

export const systemStatusInternals = {
  currentKoreanWeekStart,
  databaseStateFromSettled,
  envManagedStatus,
  uniqueExcludedParticipants,
};
