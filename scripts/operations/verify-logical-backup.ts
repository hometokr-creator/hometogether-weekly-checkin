import { isAbsolute } from "node:path";

import { verifyLogicalBackupDirectory } from "./logical-backup-verification";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const rawDirectory = argument("--directory");
  if (!rawDirectory || !isAbsolute(rawDirectory)) {
    throw new Error("Pass the absolute backup directory with --directory.");
  }
  const report = await verifyLogicalBackupDirectory(rawDirectory);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      filesVerified: report.filesVerified,
      format: report.format,
      remoteMigrationHistoryComplete: report.remoteMigrationHistoryComplete,
      migrationHistoryStatus: report.migrationHistory?.status ?? "LEGACY_DISCLOSURE",
      remoteOnlyMigrationCount: report.migrationHistory?.remoteOnlyCount ?? null,
      localOnlyMigrationCount: report.migrationHistory?.localOnlyCount ?? null,
      tablesAbsentPendingMigrationCount: report.tablesAbsentPendingMigration.length,
    })}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Backup verification failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
