import { createHash } from "node:crypto";

import {
  absentPendingMigrationTable,
  buildMigrationHistoryEvidence,
  CORE_TABLES,
  LOGICAL_BACKUP_V2_TABLES,
  localMigrationVersions,
  LOGICAL_BACKUP_FORMAT,
  type MigrationHistoryEvidence,
} from "./logical-backup-contract";
import {
  inspectSafeBackupDirectory,
  readSafeBackupFile,
  type SafeBackupDirectory,
} from "./safe-backup-files";

type LogicalBackupManifest = {
  format?: unknown;
  counts?: unknown;
  authUserCount?: unknown;
  applicationTableCount?: unknown;
  dataFiles?: unknown;
  migrations?: unknown;
  migrationFileChecksums?: unknown;
  migrationHistory?: unknown;
  localMigrationBundleOnly?: unknown;
  remoteMigrationHistoryComplete?: unknown;
  knownRemoteOnlyMigrations?: unknown;
  tablesAbsentPendingMigration?: unknown;
  storageObjectBodiesIncluded?: unknown;
  nativeDatabaseBackupIncluded?: unknown;
  pointInTimeRecoveryIncluded?: unknown;
};

export type VerifiedLogicalBackup = {
  directory: SafeBackupDirectory;
  format: string;
  filesVerified: number;
  counts: Record<string, number>;
  applicationTables: string[];
  authUserCount: number | null;
  migrationHistory: MigrationHistoryEvidence | null;
  remoteMigrationHistoryComplete: boolean;
  tablesAbsentPendingMigration: Array<{
    table: string;
    introducedByMigration: string;
  }>;
  checksums: Record<string, string>;
};

function parseJson(buffer: Buffer, label: string): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} is invalid.`);
  }
  return [...value];
}

function countsRecord(
  value: unknown,
  applicationTables: readonly string[],
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Logical backup count inventory is invalid.");
  }
  const entries = Object.entries(value);
  if (
    entries.some(
      ([table, count]) =>
        !applicationTables.includes(table) ||
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0,
    )
  ) {
    throw new Error("Logical backup count inventory is invalid.");
  }
  const expectedTables = [...applicationTables].sort();
  if (JSON.stringify(entries.map(([table]) => table).sort()) !== JSON.stringify(expectedTables)) {
    throw new Error("Logical backup application table inventory is incomplete.");
  }
  return Object.fromEntries(entries);
}

function expectedDataFiles(counts: Record<string, number>): string[] {
  return [
    ...Object.keys(counts).map((table) => `${table}.json`),
    "auth-users.json",
    "migrations.sql",
  ].sort();
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function migrationChecksums(value: unknown, migrations: readonly string[]): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Logical backup migration checksum inventory is missing.");
  }
  const entries = Object.entries(value);
  if (
    entries.some(
      ([filename, digest]) =>
        !migrations.includes(filename) ||
        typeof digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(digest),
    ) ||
    JSON.stringify(entries.map(([filename]) => filename).sort()) !==
      JSON.stringify([...migrations].sort())
  ) {
    throw new Error("Logical backup migration checksum inventory is invalid.");
  }
  return Object.fromEntries(entries);
}

function migrationBundleEntries(bundle: string): Array<{ filename: string; sql: string }> {
  const entries: Array<{ filename: string; sql: string }> = [];
  let cursor = 0;
  while (cursor < bundle.length) {
    const header = /^-- BEGIN (\d{12,14}_[a-z0-9_]+\.sql)\n/.exec(bundle.slice(cursor));
    if (!header) throw new Error("Logical backup migration bundle framing is invalid.");
    const filename = header[1];
    const bodyStart = cursor + header[0].length;
    const footer = `\n-- END ${filename}`;
    const footerStart = bundle.indexOf(footer, bodyStart);
    if (footerStart < 0) throw new Error("Logical backup migration bundle is incomplete.");
    entries.push({ filename, sql: bundle.slice(bodyStart, footerStart) });
    cursor = footerStart + footer.length;
    if (cursor === bundle.length) break;
    if (bundle[cursor] !== "\n") {
      throw new Error("Logical backup migration bundle framing is invalid.");
    }
    while (bundle[cursor] === "\n") cursor += 1;
  }
  return entries;
}

function validateAbsentPendingTables(
  manifest: LogicalBackupManifest,
  evidence: MigrationHistoryEvidence,
  counts: Record<string, number>,
): Array<{ table: string; introducedByMigration: string }> {
  if (!Array.isArray(manifest.tablesAbsentPendingMigration)) {
    throw new Error("Logical backup absent-table evidence is missing.");
  }
  const seen = new Set<string>();
  return manifest.tablesAbsentPendingMigration.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Logical backup absent-table evidence is invalid.");
    }
    const { table, introducedByMigration } = value as Record<string, unknown>;
    if (
      typeof table !== "string" ||
      typeof introducedByMigration !== "string" ||
      seen.has(table) ||
      counts[table] !== 0
    ) {
      throw new Error("Logical backup absent-table evidence is invalid.");
    }
    const expected = absentPendingMigrationTable(table, evidence);
    if (!expected || expected.introducedByMigration !== introducedByMigration) {
      throw new Error("Logical backup absent-table evidence is not tied to a local-only migration.");
    }
    seen.add(table);
    return { table, introducedByMigration };
  });
}

async function validateJsonCounts(
  directory: SafeBackupDirectory,
  counts: Record<string, number>,
  authUserCount: number | null,
): Promise<void> {
  for (const [table, expectedCount] of Object.entries(counts)) {
    const rows = parseJson(await readSafeBackupFile(directory, `${table}.json`), `${table}.json`);
    if (!Array.isArray(rows) || rows.length !== expectedCount) {
      throw new Error(`Logical backup row count does not match manifest: ${table}`);
    }
  }
  const authUsers = parseJson(
    await readSafeBackupFile(directory, "auth-users.json"),
    "auth-users.json",
  );
  if (!Array.isArray(authUsers)) throw new Error("Auth user backup is invalid.");
  if (authUserCount !== null && authUsers.length !== authUserCount) {
    throw new Error("Auth user count does not match manifest.");
  }
}

function validateV3MigrationHistory(manifest: LogicalBackupManifest): MigrationHistoryEvidence {
  const migrations = stringArray(manifest.migrations, "Logical backup migration inventory");
  const history = manifest.migrationHistory;
  if (!history || typeof history !== "object" || Array.isArray(history)) {
    throw new Error("Logical backup migration-history evidence is missing.");
  }
  const evidence = history as MigrationHistoryEvidence;
  const expected = buildMigrationHistoryEvidence(
    migrations,
    evidence.status === "NOT_CHECKED" ? null : evidence.remoteVersions,
    evidence.checkedAt ?? undefined,
  );
  if (JSON.stringify(evidence) !== JSON.stringify(expected)) {
    throw new Error("Logical backup migration-history evidence is inconsistent.");
  }
  if (
    manifest.localMigrationBundleOnly !== true ||
    manifest.remoteMigrationHistoryComplete !== (evidence.exactMatch === true) ||
    JSON.stringify(manifest.knownRemoteOnlyMigrations) !==
      JSON.stringify(evidence.missingLocalSources)
  ) {
    throw new Error("Logical backup migration-history disclosure is invalid.");
  }
  if (
    manifest.storageObjectBodiesIncluded !== false ||
    manifest.nativeDatabaseBackupIncluded !== false ||
    manifest.pointInTimeRecoveryIncluded !== false
  ) {
    throw new Error("Logical backup recovery-scope disclosure is invalid.");
  }
  return evidence;
}


function validateV3MigrationBundle(
  manifest: LogicalBackupManifest,
  migrationText: string,
): void {
  const migrations = stringArray(manifest.migrations, "Logical backup migration inventory");
  localMigrationVersions(migrations);
  const expectedChecksums = migrationChecksums(manifest.migrationFileChecksums, migrations);
  const entries = migrationBundleEntries(migrationText);
  if (
    JSON.stringify(entries.map(({ filename }) => filename)) !== JSON.stringify(migrations)
  ) {
    throw new Error("Logical backup migration bundle inventory does not match the manifest.");
  }
  for (const { filename, sql } of entries) {
    if (sha256(sql) !== expectedChecksums[filename]) {
      throw new Error("Logical backup migration bundle content does not match the manifest.");
    }
  }
}

export async function verifyLogicalBackupDirectory(
  rawDirectory: string,
): Promise<VerifiedLogicalBackup> {
  const directory = await inspectSafeBackupDirectory(rawDirectory);
  const checksumText = (await readSafeBackupFile(directory, "SHA256SUMS")).toString("utf8");
  const entries = checksumText
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
      if (!match) throw new Error("Invalid checksum manifest line.");
      return { expected: match[1], filename: match[2] };
    });
  if (new Set(entries.map((entry) => entry.filename)).size !== entries.length) {
    throw new Error("Duplicate checksum manifest filename.");
  }
  const checksums = Object.fromEntries(
    entries.map((entry) => [entry.filename, entry.expected]),
  );

  for (const entry of entries) {
    const actual = createHash("sha256")
      .update(await readSafeBackupFile(directory, entry.filename))
      .digest("hex");
    if (actual !== entry.expected) throw new Error(`Checksum mismatch: ${entry.filename}`);
  }

  const manifest = parseJson(
    await readSafeBackupFile(directory, "manifest.json"),
    "manifest.json",
  ) as LogicalBackupManifest;
  if (
    manifest.format !== "hometogether-logical-backup-v1" &&
    manifest.format !== "hometogether-logical-backup-v2" &&
    manifest.format !== LOGICAL_BACKUP_FORMAT
  ) {
    throw new Error("Unsupported logical backup format.");
  }

  if (manifest.format === "hometogether-logical-backup-v1") {
    return {
      directory,
      format: manifest.format,
      filesVerified: entries.length,
      counts: {},
      applicationTables: [],
      authUserCount: null,
      migrationHistory: null,
      remoteMigrationHistoryComplete: false,
      tablesAbsentPendingMigration: [],
      checksums,
    };
  }

  const applicationTables =
    manifest.format === "hometogether-logical-backup-v2"
      ? [...LOGICAL_BACKUP_V2_TABLES]
      : [...CORE_TABLES];
  const counts = countsRecord(manifest.counts, applicationTables);
  if (manifest.applicationTableCount !== applicationTables.length) {
    throw new Error("Logical backup application table inventory is incomplete.");
  }
  const dataFiles = stringArray(manifest.dataFiles, "Logical backup data-file inventory");
  const expectedFiles = expectedDataFiles(counts);
  if (JSON.stringify(dataFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Logical backup data-file manifest is incomplete.");
  }
  const expectedChecksummedFiles = [...expectedFiles, "database.types.ts", "manifest.json"].sort();
  const checksummedFiles = entries.map((entry) => entry.filename).sort();
  const directoryFiles = directory.filenames
    .filter((filename) => filename !== "SHA256SUMS")
    .sort();
  if (
    JSON.stringify(checksummedFiles) !== JSON.stringify(expectedChecksummedFiles) ||
    JSON.stringify(directoryFiles) !== JSON.stringify(expectedChecksummedFiles)
  ) {
    throw new Error("Logical backup checksum inventory does not match the directory.");
  }

  const authUserCount =
    typeof manifest.authUserCount === "number" &&
    Number.isSafeInteger(manifest.authUserCount) &&
    manifest.authUserCount >= 0
      ? manifest.authUserCount
      : null;
  await validateJsonCounts(directory, counts, authUserCount);

  let migrationHistory: MigrationHistoryEvidence | null = null;
  let tablesAbsentPendingMigration: Array<{
    table: string;
    introducedByMigration: string;
  }> = [];
  if (manifest.format === "hometogether-logical-backup-v2") {
    if (
      manifest.remoteMigrationHistoryComplete !== false ||
      !Array.isArray(manifest.knownRemoteOnlyMigrations) ||
      manifest.knownRemoteOnlyMigrations.some((entry) => typeof entry !== "string")
    ) {
      throw new Error("Logical backup v2 migration-history disclosure is invalid.");
    }
  } else {
    migrationHistory = validateV3MigrationHistory(manifest);
    const migrationText = (await readSafeBackupFile(directory, "migrations.sql")).toString("utf8");
    validateV3MigrationBundle(manifest, migrationText);
    tablesAbsentPendingMigration = validateAbsentPendingTables(
      manifest,
      migrationHistory,
      counts,
    );
  }

  return {
    directory,
    format: manifest.format,
    filesVerified: entries.length,
    counts,
    applicationTables,
    authUserCount,
    migrationHistory,
    remoteMigrationHistoryComplete: manifest.remoteMigrationHistoryComplete === true,
    tablesAbsentPendingMigration,
    checksums,
  };
}
