import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

const REQUIRED_ACK = "I_ACKNOWLEDGE_SENSITIVE_PRODUCTION_BACKUP";
const PAGE_SIZE = 1000;

const CORE_TABLES = [
  // Preserve the legacy application records as well as the normalized
  // weekly-check-in model. A restore must not silently omit pre-migration
  // customer-owned data.
  "app_files",
  "app_members",
  "app_records",
  "hometogether_rule_admins",
  "hometogether_rule_sessions",
  "universities",
  "university_email_domains",
  "student_email_verifications",
  "profiles",
  "homes",
  "matches",
  "weekly_checkin_runs",
  "weekly_checkin_invitations",
  "weekly_checkin_drafts",
  "weekly_checkin_responses",
  "weekly_checkin_issues",
  "support_cases",
  "support_case_events",
  "message_logs",
  "message_attempts",
  "integration_outbox",
  "weekly_checkin_signals",
  "audit_logs",
  "rate_limit_buckets",
  "cron_execution_logs",
  "admin_memberships",
  "admin_bootstrap_state",
  "data_import_batches",
  "data_import_rows",
] as const;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

async function main() {
  if (process.env.PRODUCTION_BACKUP_ACK !== REQUIRED_ACK) {
    throw new Error(`Set PRODUCTION_BACKUP_ACK=${REQUIRED_ACK} before exporting.`);
  }

  const rawOutput = argument("--output");
  if (!rawOutput || !isAbsolute(rawOutput)) {
    throw new Error("Pass a new absolute directory with --output.");
  }
  const output = resolve(rawOutput);
  if (output === "/" || output.split("/").filter(Boolean).length < 3) {
    throw new Error("Backup output directory is too broad.");
  }
  try {
    await stat(output);
    throw new Error("Backup output already exists; choose a new directory.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) throw error;
  }
  await mkdir(output, { mode: 0o700 });
  await chmod(output, 0o700);

  const { url, secret } = productionConfiguration();
  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const counts: Record<string, number> = {};
  const files: string[] = [];

  for (const table of CORE_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`${table} export failed: ${error.code ?? "DATABASE_ERROR"}`);
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

  const migrations = (await readdir(resolve("supabase/migrations")))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrationBundle = (
    await Promise.all(
      migrations.map(async (name) =>
        `-- BEGIN ${name}\n${await readFile(resolve("supabase/migrations", name), "utf8")}\n-- END ${name}`,
      ),
    )
  ).join("\n\n");
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
    remoteMigrationHistoryComplete: false,
    knownRemoteOnlyMigrations: [
      "20260807052002_hometogether_auth_and_token_access",
      "20260807052931_hometogether_auth_hardening",
      "20260807071307_bootstrap_student_email_otp",
    ],
    applicationTableCount: CORE_TABLES.length,
    format: "hometogether-logical-backup-v2",
    storageObjectBodiesIncluded: false,
    restoreWarning:
      "This exports all known application table rows, but migrations.sql contains only this repository's migrations and omits three legacy remote-only migration sources. It is not a native PostgreSQL/PITR or Storage object backup.",
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
