import { isAbsolute } from "node:path";

import { verifyLogicalBackupDirectory } from "./logical-backup-verification";
import {
  assertLocalDockerContainer,
  assertMissingTablesAreAllowed,
  assertRestoreTargetUnchanged,
  backupLabel,
  buildRestoreTransactionSql,
  discoverPresentTables,
  inspectRestoreTargetBaseline,
  loadRestorePayloads,
  localDatabaseContainer,
  readLocalProjectId,
  RESTORE_DRILL_ACK,
  runRollbackRestoreTransaction,
} from "./restore-logical-backup-lib";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.RESTORE_DRILL_ACK !== RESTORE_DRILL_ACK) {
    throw new Error(`Set RESTORE_DRILL_ACK=${RESTORE_DRILL_ACK} before the local drill.`);
  }
  const directory = argument("--directory");
  if (!directory || !isAbsolute(directory)) {
    throw new Error("Pass the absolute logical backup directory with --directory.");
  }
  const allowPartialLegacy = process.argv.includes("--allow-partial-legacy");
  const backup = await verifyLogicalBackupDirectory(directory);
  if (backup.format === "hometogether-logical-backup-v1") {
    throw new Error("Legacy v1 backups are incomplete and cannot be used for a restore drill.");
  }

  const projectId = readLocalProjectId("supabase/config.toml");
  const container = localDatabaseContainer(projectId);
  assertLocalDockerContainer(container);
  const present = discoverPresentTables(container, backup.applicationTables);
  const missing = backup.applicationTables.filter((table) => !present.has(table));
  assertMissingTablesAreAllowed(backup, missing, allowPartialLegacy);

  const presentInRestoreOrder = backup.applicationTables.filter((table) => present.has(table));
  const baseline = inspectRestoreTargetBaseline(container, presentInRestoreOrder);
  const preloadedMigrationTables = presentInRestoreOrder.filter(
    (table) => baseline.tableCounts[table] > 0,
  );
  const payloads = await loadRestorePayloads(backup, present);
  const sql = buildRestoreTransactionSql(
    payloads,
    presentInRestoreOrder,
    preloadedMigrationTables,
  );
  const result = runRollbackRestoreTransaction(container, sql);
  assertRestoreTargetUnchanged(container, presentInRestoreOrder, baseline);

  for (const table of presentInRestoreOrder) {
    if (result.tableCounts[table] !== backup.counts[table]) {
      throw new Error(`Local restore count verification failed: ${table}`);
    }
  }
  if (backup.authUserCount !== null && result.authUserCount !== backup.authUserCount) {
    throw new Error("Local restore auth-user count verification failed.");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      backup: backupLabel(directory),
      format: backup.format,
      checksumFilesVerified: backup.filesVerified,
      restoredTableCount: presentInRestoreOrder.length,
      restoredRowCount: presentInRestoreOrder.reduce(
        (sum, table) => sum + result.tableCounts[table],
        0,
      ),
      authPlaceholderCount: result.authUserCount,
      skippedLegacyTables: missing.map((table) => ({
        table,
        rowCount: backup.counts[table],
      })),
      partialLegacyRestore: missing.some((table) => (backup.counts[table] ?? 0) > 0),
      sourceTablesAbsentPendingMigration: backup.tablesAbsentPendingMigration,
      transactionRolledBack: true,
      preloadedMigrationTableCount: preloadedMigrationTables.length,
      postRollbackTargetUnchanged: true,
      productionAccessed: false,
      authSecretsRestored: false,
      storageObjectBodiesRestored: false,
    })}\n`,
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Local restore drill failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
