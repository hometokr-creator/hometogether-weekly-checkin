import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { localMigrationVersions } from "./logical-backup-contract";

const MINIMUM_BASELINE_MIGRATIONS = 15;

async function main(): Promise<void> {
  const directory = resolve("supabase/migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  if (migrations.length < MINIMUM_BASELINE_MIGRATIONS) {
    throw new Error("Migration inventory is smaller than the established baseline.");
  }
  localMigrationVersions(migrations);

  for (const migration of migrations) {
    const path = resolve(directory, migration);
    const fileStat = await lstat(path);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new Error(`Migration is not a regular file: ${migration}`);
    }
    if (fileStat.size === 0 || fileStat.size > 2 * 1024 * 1024) {
      throw new Error(`Migration size is outside the allowed range: ${migration}`);
    }
    const sql = await readFile(path, "utf8");
    if (sql.includes("\0") || !sql.trim()) {
      throw new Error(`Migration content is invalid: ${migration}`);
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, migrationCount: migrations.length })}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Migration validation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
