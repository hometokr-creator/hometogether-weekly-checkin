import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  absentPendingMigrationTable,
  buildMigrationHistoryEvidence,
  CORE_TABLES,
  LOGICAL_BACKUP_FORMAT,
  normalizeRemoteMigrationVersions,
  type AbsentPendingMigrationTable,
} from "./logical-backup-contract";

const REQUIRED_ACK = "I_ACKNOWLEDGE_SENSITIVE_PRODUCTION_BACKUP";
const PAGE_SIZE = 1000;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function remoteMigrationVersions(url: string): Promise<string[] | null> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) return null;

  const projectRef = new URL(url).hostname.split(".")[0];
  const configuredRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (configuredRef && configuredRef !== projectRef) {
    throw new Error("SUPABASE_PROJECT_REF does not match the backup project host.");
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query:
          "select version::text as version from supabase_migrations.schema_migrations order by version",
      }),
    },
  );
  if (!response.ok) {
    throw new Error("Remote migration history verification failed.");
  }
  return normalizeRemoteMigrationVersions(await response.json());
}

function productionConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Production Supabase URL and server key are required.");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    !parsed.hostname.endsWith(".supabase.co")
  ) {
    throw new Error("Logical backup accepts only a remote HTTPS Supabase project.");
  }
  return { url: parsed.origin, secret };
}

async function writePrivateJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function gitTrackedMigrationPaths(): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--", "supabase/migrations"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return output
    .split("\0")
    .filter((path) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))
    .sort();
}

async function trackedMigrationFiles(): Promise<string[]> {
  const trackedPaths = gitTrackedMigrationPaths();
  const tracked = trackedPaths.map((path) => basename(path));
  const onDisk = (await readdir(resolve("supabase/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (JSON.stringify(tracked) !== JSON.stringify(onDisk)) {
    throw new Error(
      "Tracked migration inventory does not match the working tree; commit approved migrations first.",
    );
  }
  return tracked;
}

async function assertGitExternalNewOutput(rawOutput: string): Promise<string> {
  const output = resolve(rawOutput);
  if (output === "/" || output.split("/").filter(Boolean).length < 3) {
    throw new Error("Backup output directory is too broad.");
  }
  try {
    await lstat(output);
    throw new Error("Backup output already exists; choose a new directory.");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  const parent = await realpath(dirname(output));
  const canonicalOutput = join(parent, basename(output));
  const repository = await realpath(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );
  const repositoryRelative = relative(repository, canonicalOutput);
  if (
    repositoryRelative === "" ||
    (!repositoryRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      repositoryRelative !== ".." &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new Error("Logical backup output must be outside the Git repository.");
  }
  return canonicalOutput;
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

async function main() {
  if (process.env.PRODUCTION_BACKUP_ACK !== REQUIRED_ACK) {
    throw new Error(`Set PRODUCTION_BACKUP_ACK=${REQUIRED_ACK} before exporting.`);
  }

  const rawOutput = argument("--output");
  if (!rawOutput || !isAbsolute(rawOutput)) {
    throw new Error("Pass a new absolute directory with --output.");
  }
  const output = await assertGitExternalNewOutput(rawOutput);

  const { url, secret } = productionConfiguration();
  const migrations = await trackedMigrationFiles();
  const migrationHistory = buildMigrationHistoryEvidence(
    migrations,
    await remoteMigrationVersions(url),
  );

  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const counts: Record<string, number> = {};
  const files: string[] = [];
  const tablesAbsentPendingMigration: AbsentPendingMigrationTable[] = [];

  for (const table of CORE_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        const pendingTable = isMissingRelation(error)
          ? absentPendingMigrationTable(table, migrationHistory)
          : null;
        if (pendingTable && from === 0) {
          tablesAbsentPendingMigration.push(pendingTable);
          break;
        }
        throw new Error(`${table} export failed: ${error.code ?? "DATABASE_ERROR"}`);
      }
      rows.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
    const filename = `${table}.json`;
    await writePrivateJson(join(output, filename), rows);
    counts[table] = rows.length;
    files.push(filename);
  }

  const authUsers: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Auth export failed: ${error.name}`);
    authUsers.push(...data.users);
    if (data.users.length < PAGE_SIZE) break;
  }
  await writePrivateJson(join(output, "auth-users.json"), authUsers);
  files.push("auth-users.json");

  const migrationSources = await Promise.all(
    migrations.map(async (name) => ({
      name,
      sql: await readFile(resolve("supabase/migrations", name), "utf8"),
    })),
  );
  const migrationBundle = migrationSources
    .map(({ name, sql }) => `-- BEGIN ${name}\n${sql}\n-- END ${name}`)
    .join("\n\n");
  const migrationFileChecksums = Object.fromEntries(
    migrationSources.map(({ name, sql }) => [
      name,
      createHash("sha256").update(sql).digest("hex"),
    ]),
  );
  await writeFile(join(output, "migrations.sql"), `${migrationBundle}\n`, { mode: 0o600 });
  await chmod(join(output, "migrations.sql"), 0o600);
  files.push("migrations.sql");

  const manifest = {
    createdAt: new Date().toISOString(),
    projectHost: new URL(url).hostname,
    counts,
    authUserCount: authUsers.length,
    migrations,
    dataFiles: [...files].sort(),
    localMigrationBundleOnly: true,
    migrationHistory,
    migrationFileChecksums,
    remoteMigrationHistoryComplete: migrationHistory.exactMatch === true,
    knownRemoteOnlyMigrations: migrationHistory.missingLocalSources,
    tablesAbsentPendingMigration,
    applicationTableCount: CORE_TABLES.length,
    format: LOGICAL_BACKUP_FORMAT,
    storageObjectBodiesIncluded: false,
    nativeDatabaseBackupIncluded: false,
    pointInTimeRecoveryIncluded: false,
    restoreWarning:
      "This application logical backup is not a native PostgreSQL backup, Point-in-Time Recovery snapshot, Auth secret export, or Storage object-body backup. Migration parity only compares Supabase migration version history; it does not prove that unmanaged legacy schema objects can be recreated.",
  };
  await writePrivateJson(join(output, "manifest.json"), manifest);
  files.push("manifest.json");

  await copyFile(resolve("lib/database.types.ts"), join(output, "database.types.ts"));
  await chmod(join(output, "database.types.ts"), 0o600);
  files.push("database.types.ts");

  const checksumLines: string[] = [];
  for (const filename of files.sort()) {
    const digest = createHash("sha256")
      .update(await readFile(join(output, filename)))
      .digest("hex");
    checksumLines.push(`${digest}  ${filename}`);
  }
  await writeFile(join(output, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, {
    mode: 0o600,
  });
  await chmod(join(output, "SHA256SUMS"), 0o600);

  process.stdout.write(
    `${JSON.stringify({ ok: true, output, tableCount: CORE_TABLES.length, counts })}\n`,
  );
}

main().catch((error) => {
  const name = error instanceof Error ? error.name : "BackupError";
  process.stderr.write(`Logical backup failed (${name}).\n`);
  process.exitCode = 1;
});
