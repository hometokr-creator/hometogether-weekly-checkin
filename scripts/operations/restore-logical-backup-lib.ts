import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { VerifiedLogicalBackup } from "./logical-backup-verification";
import { readSafeBackupFile } from "./safe-backup-files";

export const RESTORE_DRILL_ACK = "I_ACKNOWLEDGE_LOCAL_ROLLBACK_RESTORE_DRILL";

export const UNMANAGED_LEGACY_TABLES = ["app_records", "app_members", "app_files"] as const;
export const MIGRATION_BOOTSTRAP_TABLES = [
  "universities",
  "university_email_domains",
] as const;

type AuthUserExport = {
  id?: unknown;
  email?: unknown;
  aud?: unknown;
  role?: unknown;
  email_confirmed_at?: unknown;
  app_metadata?: unknown;
  user_metadata?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type RestorePayloads = {
  authUsers: string;
  tables: Record<string, string>;
};

export type RestoreTargetCounts = {
  authUserCount: number;
  tableCounts: Record<string, number>;
};

function sqlBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function readLocalProjectId(configPath: string): string {
  const config = readFileSync(resolve(configPath), "utf8");
  const match = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"\s*$/m.exec(config);
  if (!match) throw new Error("Local Supabase project_id is missing or unsafe.");
  return match[1];
}

export function localDatabaseContainer(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) {
    throw new Error("Local Supabase project_id is unsafe.");
  }
  return `supabase_db_${projectId}`;
}

async function checkedJsonRows(
  backup: VerifiedLogicalBackup,
  filename: string,
): Promise<unknown[]> {
  const buffer = await readSafeBackupFile(backup.directory, filename);
  const expected = backup.checksums[filename];
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (!expected || actual !== expected) {
    throw new Error(`Logical backup changed after verification: ${filename}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`Logical backup JSON is invalid: ${filename}`);
  }
  if (!Array.isArray(value)) throw new Error(`Logical backup rows are invalid: ${filename}`);
  return value;
}

export async function loadRestorePayloads(
  backup: VerifiedLogicalBackup,
  presentTables: ReadonlySet<string>,
): Promise<RestorePayloads> {
  const exportedUsers = (await checkedJsonRows(backup, "auth-users.json")) as AuthUserExport[];
  const authUsers = exportedUsers.map((user) => ({
    id: user.id,
    email: user.email ?? null,
    aud: user.aud ?? "authenticated",
    role: user.role ?? "authenticated",
    email_confirmed_at: user.email_confirmed_at ?? null,
    app_metadata: user.app_metadata ?? {},
    user_metadata: user.user_metadata ?? {},
    created_at: user.created_at ?? null,
    updated_at: user.updated_at ?? null,
  }));
  const tables: Record<string, string> = {};
  for (const table of backup.applicationTables) {
    if (!presentTables.has(table)) continue;
    tables[table] = sqlBase64Json(await checkedJsonRows(backup, `${table}.json`));
  }
  return { authUsers: sqlBase64Json(authUsers), tables };
}

export function assertMissingTablesAreAllowed(
  backup: VerifiedLogicalBackup,
  missingTables: readonly string[],
  allowPartialLegacy: boolean,
): void {
  const unmanaged = new Set<string>(UNMANAGED_LEGACY_TABLES);
  const unexpected = missingTables.filter((table) => !unmanaged.has(table));
  if (unexpected.length > 0) {
    throw new Error(`Local restore schema is missing managed tables: ${unexpected.join(", ")}`);
  }
  const missingRows = missingTables.reduce((sum, table) => sum + (backup.counts[table] ?? 0), 0);
  if (missingRows > 0 && !allowPartialLegacy) {
    throw new Error(
      "Backup contains rows for unmanaged legacy tables; pass --allow-partial-legacy only after recording this restore gap.",
    );
  }
}

export function buildRestoreTransactionSql(
  payloads: RestorePayloads,
  presentTables: readonly string[],
  preloadedMigrationTables: readonly string[] = [],
): string {
  const allowedPreloaded = new Set<string>(MIGRATION_BOOTSTRAP_TABLES);
  if (
    preloadedMigrationTables.some(
      (table) => !allowedPreloaded.has(table) || !presentTables.includes(table),
    )
  ) {
    throw new Error("Restore target contains an unsupported preloaded table.");
  }
  const preloaded = new Set(preloadedMigrationTables);
  const lines = [
    "begin;",
    "set local statement_timeout = '5min';",
    "set local lock_timeout = '5s';",
    "set local client_min_messages = warning;",
    "do $restore$ begin",
    "  if exists (select 1 from auth.users limit 1) then raise exception 'RESTORE_TARGET_NOT_EMPTY'; end if;",
  ];
  for (const table of presentTables) {
    if (preloaded.has(table)) continue;
    lines.push(
      `  if exists (select 1 from public."${table}" limit 1) then raise exception 'RESTORE_TARGET_NOT_EMPTY'; end if;`,
    );
  }
  lines.push("end $restore$;");
  for (const table of [...MIGRATION_BOOTSTRAP_TABLES].reverse()) {
    if (preloaded.has(table)) {
      lines.push(`delete from public."${table}";`);
    }
  }
  lines.push(
    `do $restore_auth$ begin
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid, x.id, coalesce(x.aud, 'authenticated'), coalesce(x.role, 'authenticated'), x.email, '', x.email_confirmed_at, coalesce(x.app_metadata, '{}'::jsonb), coalesce(x.user_metadata, '{}'::jsonb), coalesce(x.created_at, now()), coalesce(x.updated_at, now())
from jsonb_to_recordset(convert_from(decode('${payloads.authUsers}', 'base64'), 'utf8')::jsonb)
  as x(id uuid, email text, aud text, role text, email_confirmed_at timestamptz, app_metadata jsonb, user_metadata jsonb, created_at timestamptz, updated_at timestamptz);
exception when others then
  raise exception 'RESTORE_AUTH_PLACEHOLDER_FAILED';
end $restore_auth$;`,
  );
  for (const table of presentTables) {
    lines.push(
      `do $restore_table$
declare
  v_payload jsonb := convert_from(decode('${payloads.tables[table]}', 'base64'), 'utf8')::jsonb;
  v_columns text;
  v_payload_key_count integer;
  v_schema_key_count integer;
begin
  if jsonb_typeof(v_payload) <> 'array' then
    raise exception 'RESTORE_TABLE_PAYLOAD_INVALID';
  end if;
  if jsonb_array_length(v_payload) = 0 then
    return;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_payload) as rows(row_value)
    where jsonb_typeof(row_value) <> 'object'
  ) then
    raise exception 'RESTORE_TABLE_PAYLOAD_INVALID';
  end if;

  select count(distinct key_name)
  into v_payload_key_count
  from jsonb_array_elements(v_payload) as rows(row_value)
  cross join lateral jsonb_object_keys(row_value) as keys(key_name);

  select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
         count(*)
  into v_columns, v_schema_key_count
  from pg_attribute attribute
  where attribute.attrelid = 'public."${table}"'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attname in (
      select distinct key_name
      from jsonb_array_elements(v_payload) as rows(row_value)
      cross join lateral jsonb_object_keys(row_value) as keys(key_name)
    );

  if v_columns is null or v_schema_key_count <> v_payload_key_count then
    raise exception 'RESTORE_SCHEMA_COLUMN_MISMATCH';
  end if;

  execute format(
    'insert into public."${table}" (%s) select %s from jsonb_populate_recordset(null::public."${table}", $1)',
    v_columns,
    v_columns
  ) using v_payload;
exception when others then
  raise exception 'RESTORE_TABLE_FAILED:${table}';
end $restore_table$;`,
    );
  }
  lines.push("select '__HT_RESTORE_AUTH_COUNT__:' || count(*)::text from auth.users;");
  for (const table of presentTables) {
    lines.push(
      `select '__HT_RESTORE_COUNT__:${table}:' || count(*)::text from public."${table}";`,
    );
  }
  lines.push("rollback;");
  return `${lines.join("\n")}\n`;
}

type DockerResult = { status: number | null; stdout: string; stderr: string };

function docker(args: string[], input?: string): DockerResult {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function assertLocalDockerContainer(container: string): void {
  const context = docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]);
  const endpoint = context.stdout.trim();
  if (context.status !== 0 || (!endpoint.startsWith("unix://") && !endpoint.startsWith("npipe://"))) {
    throw new Error("Restore drill requires a local Docker daemon.");
  }
  const state = docker(["inspect", "--format", "{{.State.Running}}", container]);
  if (state.status !== 0 || state.stdout.trim() !== "true") {
    throw new Error("The expected local Supabase database container is not running.");
  }
}

function psql(container: string, sql: string): DockerResult {
  return docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--quiet",
      "--username=postgres",
      "--dbname=postgres",
    ],
    sql,
  );
}

function readRestoreTargetCounts(
  container: string,
  presentTables: readonly string[],
): RestoreTargetCounts {
  const statements = [
    "select '__HT_RESTORE_TARGET_AUTH__:' || count(*)::text from auth.users;",
    ...presentTables.map(
      (table) =>
        `select '__HT_RESTORE_TARGET_TABLE__:${table}:' || count(*)::text from public."${table}";`,
    ),
  ];
  const result = psql(container, `${statements.join("\n")}\n`);
  if (result.status !== 0) {
    throw new Error("Could not inspect the isolated restore target; database details suppressed.");
  }
  let authUserCount: number | null = null;
  const tableCounts: Record<string, number> = {};
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("__HT_RESTORE_TARGET_AUTH__:")) {
      authUserCount = Number(line.slice("__HT_RESTORE_TARGET_AUTH__:".length));
      continue;
    }
    const [, table, count] =
      /^__HT_RESTORE_TARGET_TABLE__:([A-Za-z0-9_]+):(\d+)$/.exec(line) ?? [];
    if (table && count !== undefined) tableCounts[table] = Number(count);
  }
  if (
    authUserCount === null ||
    !Number.isSafeInteger(authUserCount) ||
    presentTables.some(
      (table) => !Number.isSafeInteger(tableCounts[table]) || tableCounts[table] < 0,
    )
  ) {
    throw new Error("Restore target count output is invalid.");
  }
  return { authUserCount, tableCounts };
}

export function inspectRestoreTargetBaseline(
  container: string,
  presentTables: readonly string[],
): RestoreTargetCounts {
  const baseline = readRestoreTargetCounts(container, presentTables);
  if (baseline.authUserCount !== 0) {
    throw new Error("The isolated restore target contains Auth users.");
  }
  const allowedPreloaded = new Set<string>(MIGRATION_BOOTSTRAP_TABLES);
  const unexpected = presentTables.filter(
    (table) => baseline.tableCounts[table] > 0 && !allowedPreloaded.has(table),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `The isolated restore target contains application rows: ${unexpected.join(", ")}`,
    );
  }
  return baseline;
}

export function discoverPresentTables(
  container: string,
  applicationTables: readonly string[],
): Set<string> {
  const values = applicationTables.map((table) => `'${table}'`).join(",");
  const result = psql(
    container,
    `select name from unnest(array[${values}]::text[]) name where to_regclass('public.' || name) is not null order by name;\n`,
  );
  if (result.status !== 0) {
    throw new Error("Could not inspect the isolated local restore schema; database details suppressed.");
  }
  const present = new Set(result.stdout.split("\n").filter(Boolean));
  if ([...present].some((table) => !applicationTables.includes(table))) {
    throw new Error("Local restore schema inspection returned an unexpected table.");
  }
  return present;
}

export function runRollbackRestoreTransaction(
  container: string,
  sql: string,
): { authUserCount: number; tableCounts: Record<string, number> } {
  const result = psql(container, sql);
  if (result.status !== 0) {
    const safeMarker = /(RESTORE_(?:AUTH_PLACEHOLDER|TABLE)_FAILED(?::[A-Za-z0-9_]+)?)/.exec(
      result.stderr,
    )?.[1];
    throw new Error(
      `Local restore transaction failed${safeMarker ? ` (${safeMarker})` : ""}; database details suppressed and no rows were committed.`,
    );
  }
  const tableCounts: Record<string, number> = {};
  let authUserCount: number | null = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("__HT_RESTORE_AUTH_COUNT__:")) {
      authUserCount = Number(line.slice("__HT_RESTORE_AUTH_COUNT__:".length));
    } else if (line.startsWith("__HT_RESTORE_COUNT__:")) {
      const [, table, count] = /^__HT_RESTORE_COUNT__:([A-Za-z0-9_]+):(\d+)$/.exec(line) ?? [];
      if (!table || count === undefined) throw new Error("Local restore count output is invalid.");
      tableCounts[table] = Number(count);
    }
  }
  if (authUserCount === null || !Number.isSafeInteger(authUserCount)) {
    throw new Error("Local restore auth count output is missing.");
  }
  return { authUserCount, tableCounts };
}

export function assertRestoreTargetUnchanged(
  container: string,
  presentTables: readonly string[],
  baseline: RestoreTargetCounts,
): void {
  const after = readRestoreTargetCounts(container, presentTables);
  if (
    after.authUserCount !== baseline.authUserCount ||
    presentTables.some((table) => after.tableCounts[table] !== baseline.tableCounts[table])
  ) {
    throw new Error(
      "Local restore target changed after rollback; database details suppressed.",
    );
  }
}

export function backupLabel(path: string): string {
  return basename(resolve(path));
}
