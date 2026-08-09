import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { VerifiedLogicalBackup } from "../../scripts/operations/logical-backup-verification";
import {
  assertMissingTablesAreAllowed,
  buildRestoreTransactionSql,
  localDatabaseContainer,
  readLocalProjectId,
} from "../../scripts/operations/restore-logical-backup-lib";

function backupWithCounts(counts: Record<string, number>): VerifiedLogicalBackup {
  return { counts } as VerifiedLogicalBackup;
}

describe("logical backup restore drill safety", () => {
  it("derives the local Supabase database container from a safe project id", () => {
    const directory = mkdtempSync(join(tmpdir(), "restore-config-test-"));
    try {
      const config = join(directory, "config.toml");
      writeFileSync(config, 'project_id = "hometogether-weekly-checkin"\n');
      expect(localDatabaseContainer(readLocalProjectId(config))).toBe(
        "supabase_db_hometogether-weekly-checkin",
      );
      expect(() => localDatabaseContainer("unsafe/name")).toThrow(/unsafe/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses missing managed tables and requires an explicit partial-legacy flag", () => {
    const backup = backupWithCounts({ app_records: 9, profiles: 0 });
    expect(() => assertMissingTablesAreAllowed(backup, ["profiles"], true)).toThrow(
      /managed tables/,
    );
    expect(() => assertMissingTablesAreAllowed(backup, ["app_records"], false)).toThrow(
      /allow-partial-legacy/,
    );
    expect(() => assertMissingTablesAreAllowed(backup, ["app_records"], true)).not.toThrow();
  });

  it("builds a rollback-only transaction and keeps row JSON base64 encoded", () => {
    const sql = buildRestoreTransactionSql(
      {
        authUsers: Buffer.from("[]").toString("base64"),
        tables: {
          profiles: Buffer.from('[{"display_name":"private example"}]').toString("base64"),
        },
      },
      ["profiles"],
    );
    expect(sql).toContain("begin;");
    expect(sql).toContain("rollback;");
    expect(sql).not.toMatch(/\bcommit\b/i);
    expect(sql).not.toContain("private example");
    expect(sql).toContain("RESTORE_TARGET_NOT_EMPTY");
    expect(sql).toContain("RESTORE_SCHEMA_COLUMN_MISMATCH");
    expect(sql).not.toContain('insert into public."profiles" select *');
  });

  it("allows only migration-owned lookup rows and deletes them inside the rollback", () => {
    const sql = buildRestoreTransactionSql(
      {
        authUsers: Buffer.from("[]").toString("base64"),
        tables: {
          universities: Buffer.from("[]").toString("base64"),
          university_email_domains: Buffer.from("[]").toString("base64"),
        },
      },
      ["universities", "university_email_domains"],
      ["universities", "university_email_domains"],
    );
    expect(sql).toContain('delete from public."university_email_domains";');
    expect(sql).toContain('delete from public."universities";');
    expect(sql.indexOf('delete from public."university_email_domains";')).toBeLessThan(
      sql.indexOf('delete from public."universities";'),
    );
    expect(() =>
      buildRestoreTransactionSql(
        { authUsers: "W10=", tables: { profiles: "W10=" } },
        ["profiles"],
        ["profiles"],
      ),
    ).toThrow(/unsupported preloaded table/);
  });

  it("requires a post-rollback empty-target assertion in the CLI", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile("scripts/operations/restore-logical-backup.ts", "utf8"),
    );
    expect(source).toContain("assertRestoreTargetUnchanged");
    expect(source).toContain("postRollbackTargetUnchanged: true");
  });
});
