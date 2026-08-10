const TABLES_THROUGH_MESSAGE_LOGS = [
  // Keep this in dependency order so a local restore drill can replay rows
  // without disabling foreign-key or trigger enforcement.
  "app_records",
  "app_members",
  "app_files",
  "hometogether_rule_admins",
  "hometogether_rule_sessions",
  "universities",
  "university_email_domains",
  "student_email_verifications",
  "profiles",
  "homes",
  "admin_memberships",
  "admin_bootstrap_state",
  "matches",
  "weekly_checkin_runs",
  "weekly_checkin_invitations",
  "weekly_checkin_drafts",
  "weekly_checkin_responses",
  "weekly_checkin_issues",
  "support_cases",
  "support_case_events",
  "message_logs",
] as const;

const TABLES_AFTER_MESSAGE_LOGS = [
  "message_attempts",
  "integration_outbox",
  "weekly_checkin_signals",
  "audit_logs",
  "rate_limit_buckets",
  "cron_execution_logs",
  "data_import_batches",
  "data_import_rows",
] as const;

/** Historical table inventory used by the existing v2 Production backup. */
export const LOGICAL_BACKUP_V2_TABLES = [
  ...TABLES_THROUGH_MESSAGE_LOGS,
  ...TABLES_AFTER_MESSAGE_LOGS,
] as const;

/** Current table inventory. New logical backups use this v3 contract. */
export const CORE_TABLES = [
  ...TABLES_THROUGH_MESSAGE_LOGS,
  "message_delivery_receipts",
  ...TABLES_AFTER_MESSAGE_LOGS,
] as const;

export const LOGICAL_BACKUP_FORMAT = "hometogether-logical-backup-v3" as const;

/**
 * A table may be absent from Production only while the exact additive
 * migration that creates it is still local-only. This list is deliberately
 * narrow: an arbitrary missing or inaccessible table must fail the backup.
 */
export const TABLE_INTRODUCTION_MIGRATIONS = {
  message_delivery_receipts: "20260809090828",
} as const satisfies Partial<Record<(typeof CORE_TABLES)[number], string>>;

const MIGRATION_FILENAME = /^(\d{12,14})_[a-z0-9_]+\.sql$/;
const MIGRATION_VERSION = /^\d{12,14}$/;

export type MigrationHistoryStatus = "MATCHED" | "MISMATCHED" | "NOT_CHECKED";

export type MigrationHistoryEvidence = {
  status: MigrationHistoryStatus;
  source: "supabase-management-api" | "not-checked";
  checkedAt: string | null;
  localVersions: string[];
  remoteVersions: string[] | null;
  localCount: number;
  remoteCount: number | null;
  missingLocalSources: string[] | null;
  pendingLocalVersions: string[] | null;
  remoteOnlyVersions: string[] | null;
  localOnlyVersions: string[] | null;
  remoteOnlyCount: number | null;
  localOnlyCount: number | null;
  exactMatch: boolean | null;
};

export type AbsentPendingMigrationTable = {
  table: keyof typeof TABLE_INTRODUCTION_MIGRATIONS;
  introducedByMigration: string;
};

export function migrationVersionFromFilename(filename: string): string {
  const match = MIGRATION_FILENAME.exec(filename);
  if (!match) throw new Error("Invalid migration filename in logical backup inventory.");
  return match[1];
}

export function localMigrationVersions(filenames: readonly string[]): string[] {
  const versions = filenames.map(migrationVersionFromFilename).sort();
  if (new Set(versions).size !== versions.length) {
    throw new Error("Duplicate local migration version in logical backup inventory.");
  }
  return versions;
}

export function normalizeRemoteMigrationVersions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Remote migration history response is invalid.");
  const versions = value.map((row) => {
    if (!row || typeof row !== "object") {
      throw new Error("Remote migration history response is invalid.");
    }
    const version = String((row as { version?: unknown }).version ?? "");
    if (!MIGRATION_VERSION.test(version)) {
      throw new Error("Remote migration history response is invalid.");
    }
    return version;
  });
  if (new Set(versions).size !== versions.length) {
    throw new Error("Remote migration history contains duplicate versions.");
  }
  return versions.sort();
}

export function buildMigrationHistoryEvidence(
  migrations: readonly string[],
  remoteVersions: readonly string[] | null,
  checkedAt = new Date().toISOString(),
): MigrationHistoryEvidence {
  const localVersions = localMigrationVersions(migrations);
  if (remoteVersions === null) {
    return {
      status: "NOT_CHECKED",
      source: "not-checked",
      checkedAt: null,
      localVersions,
      remoteVersions: null,
      localCount: localVersions.length,
      remoteCount: null,
      missingLocalSources: null,
      pendingLocalVersions: null,
      remoteOnlyVersions: null,
      localOnlyVersions: null,
      remoteOnlyCount: null,
      localOnlyCount: null,
      exactMatch: null,
    };
  }

  const normalizedRemote = [...remoteVersions].map(String).sort();
  if (
    normalizedRemote.some((version) => !MIGRATION_VERSION.test(version)) ||
    new Set(normalizedRemote).size !== normalizedRemote.length
  ) {
    throw new Error("Remote migration history is invalid.");
  }
  const localSet = new Set(localVersions);
  const remoteSet = new Set(normalizedRemote);
  const missingLocalSources = normalizedRemote.filter((version) => !localSet.has(version));
  const pendingLocalVersions = localVersions.filter((version) => !remoteSet.has(version));
  const exactMatch = missingLocalSources.length === 0 && pendingLocalVersions.length === 0;

  return {
    status: exactMatch ? "MATCHED" : "MISMATCHED",
    source: "supabase-management-api",
    checkedAt,
    localVersions,
    remoteVersions: normalizedRemote,
    localCount: localVersions.length,
    remoteCount: normalizedRemote.length,
    missingLocalSources,
    pendingLocalVersions,
    remoteOnlyVersions: missingLocalSources,
    localOnlyVersions: pendingLocalVersions,
    remoteOnlyCount: missingLocalSources.length,
    localOnlyCount: pendingLocalVersions.length,
    exactMatch,
  };
}

export function absentPendingMigrationTable(
  table: string,
  migrationHistory: MigrationHistoryEvidence,
): AbsentPendingMigrationTable | null {
  const introducedByMigration = (
    TABLE_INTRODUCTION_MIGRATIONS as Partial<Record<string, string>>
  )[table];
  if (
    !introducedByMigration ||
    !migrationHistory.localOnlyVersions?.includes(introducedByMigration)
  ) {
    return null;
  }
  return {
    table: table as keyof typeof TABLE_INTRODUCTION_MIGRATIONS,
    introducedByMigration,
  };
}
