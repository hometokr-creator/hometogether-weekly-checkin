import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "scripts/operations/logical-backup.ts"),
  "utf8",
);

const expectedApplicationTables = [
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

function createBackupFixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "hometogether-backup-test-"));
  const counts = Object.fromEntries(expectedApplicationTables.map((table) => [table, 0]));
  const dataFiles = [
    ...expectedApplicationTables.map((table) => `${table}.json`),
    "auth-users.json",
    "migrations.sql",
  ].sort();
  for (const filename of dataFiles) {
    writeFileSync(join(directory, filename), filename.endsWith(".json") ? "[]\n" : "--\n");
  }
  writeFileSync(join(directory, "database.types.ts"), "export {};\n");
  writeFileSync(
    join(directory, "manifest.json"),
    `${JSON.stringify({
      format: "hometogether-logical-backup-v2",
      counts,
      applicationTableCount: 29,
      dataFiles,
      remoteMigrationHistoryComplete: false,
      knownRemoteOnlyMigrations: ["one", "two", "three"],
    })}\n`,
  );
  const checksums = readdirSync(directory)
    .sort()
    .map((filename) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(directory, filename)))
        .digest("hex");
      return `${digest}  ${filename}`;
    });
  writeFileSync(join(directory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  return directory;
}

function runVerifier(directory: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/operations/verify-logical-backup.ts",
      "--",
      "--directory",
      directory,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}

describe("logical backup inventory", () => {
  it("includes every current public application table", () => {
    for (const table of expectedApplicationTables) {
      expect(source).toContain(`"${table}"`);
    }
    expect(expectedApplicationTables).toHaveLength(29);
  });

  it("does not claim that the local migration bundle contains remote-only history", () => {
    expect(source).toContain("localMigrationBundleOnly: true");
    expect(source).toContain("remoteMigrationHistoryComplete: false");
    expect(source).toContain("20260807052002_hometogether_auth_and_token_access");
    expect(source).toContain("20260807052931_hometogether_auth_hardening");
    expect(source).toContain("20260807071307_bootstrap_student_email_otp");
    expect(source).toContain('format: "hometogether-logical-backup-v2"');
  });

  it("accepts a complete v2 checksum and file inventory", () => {
    const directory = createBackupFixture();
    try {
      expect(runVerifier(directory).status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a missing application table file", () => {
    const directory = createBackupFixture();
    try {
      unlinkSync(join(directory, "profiles.json"));
      expect(runVerifier(directory).status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a duplicate checksum filename", () => {
    const directory = createBackupFixture();
    try {
      const firstLine = readFileSync(join(directory, "SHA256SUMS"), "utf8").split("\n")[0];
      appendFileSync(join(directory, "SHA256SUMS"), `${firstLine}\n`);
      expect(runVerifier(directory).status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
