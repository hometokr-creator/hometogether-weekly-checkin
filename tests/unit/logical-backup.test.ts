import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  absentPendingMigrationTable,
  buildMigrationHistoryEvidence,
  CORE_TABLES,
  LOGICAL_BACKUP_V2_TABLES,
  LOGICAL_BACKUP_FORMAT,
} from "../../scripts/operations/logical-backup-contract";

const backupSource = readFileSync(
  join(process.cwd(), "scripts/operations/logical-backup.ts"),
  "utf8",
);

type FixtureOptions = {
  format?: "hometogether-logical-backup-v2" | typeof LOGICAL_BACKUP_FORMAT;
  remoteVersions?: string[] | null;
  countOverrides?: Record<string, number>;
  absentReceiptTable?: boolean;
};

function createBackupFixture(options: FixtureOptions = {}): string {
  const directory = mkdtempSync(join(tmpdir(), "hometogether-backup-test-"));
  const format = options.format ?? "hometogether-logical-backup-v2";
  const applicationTables =
    format === "hometogether-logical-backup-v2"
      ? [...LOGICAL_BACKUP_V2_TABLES]
      : [...CORE_TABLES];
  const counts = Object.fromEntries(applicationTables.map((table) => [table, 0]));
  Object.assign(counts, options.countOverrides);
  const dataFiles = [
    ...applicationTables.map((table) => `${table}.json`),
    "auth-users.json",
    "migrations.sql",
  ].sort();
  for (const filename of dataFiles) {
    writeFileSync(join(directory, filename), filename.endsWith(".json") ? "[]\n" : "--\n");
  }
  writeFileSync(join(directory, "database.types.ts"), "export {};\n");

  const common = {
    format,
    counts,
    authUserCount: 0,
    applicationTableCount: applicationTables.length,
    dataFiles,
  };
  const manifest =
    format === "hometogether-logical-backup-v2"
      ? {
          ...common,
          remoteMigrationHistoryComplete: false,
          knownRemoteOnlyMigrations: ["one", "two", "three"],
        }
      : (() => {
          const migrations = [
            "202608020001_initial.sql",
            "202608020002_security.sql",
            "20260809090828_harden_admin_privacy_and_message_receipts.sql",
          ];
          const remoteVersions =
            options.remoteVersions === undefined
              ? ["202608020001", "202608020002", "20260809090828"]
              : options.remoteVersions;
          const migrationHistory = buildMigrationHistoryEvidence(
            migrations,
            remoteVersions,
            "2026-08-09T00:00:00.000Z",
          );
          writeFileSync(
            join(directory, "migrations.sql"),
            migrations
              .map((migration) => `-- BEGIN ${migration}\nselect 1;\n-- END ${migration}`)
              .join("\n\n"),
          );
          const migrationFileChecksums = Object.fromEntries(
            migrations.map((migration) => [
              migration,
              createHash("sha256").update("select 1;").digest("hex"),
            ]),
          );
          return {
            ...common,
            migrations,
            localMigrationBundleOnly: true,
            migrationHistory,
            migrationFileChecksums,
            remoteMigrationHistoryComplete: migrationHistory.exactMatch === true,
            knownRemoteOnlyMigrations: migrationHistory.missingLocalSources,
            tablesAbsentPendingMigration: options.absentReceiptTable
              ? [
                  {
                    table: "message_delivery_receipts",
                    introducedByMigration: "20260809090828",
                  },
                ]
              : [],
            storageObjectBodiesIncluded: false,
            nativeDatabaseBackupIncluded: false,
            pointInTimeRecoveryIncluded: false,
          };
        })();
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  const checksums = readdirSync(directory)
    .sort()
    .map((filename) => {
      const digest = createHash("sha256")
        .update(readFileSync(join(directory, filename)))
        .digest("hex");
      return `${digest}  ${filename}`;
    });
  writeFileSync(join(directory, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  for (const filename of readdirSync(directory)) {
    chmodSync(join(directory, filename), 0o600);
  }
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

function refreshChecksum(directory: string, filename: string): void {
  const checksumPath = join(directory, "SHA256SUMS");
  const digest = createHash("sha256").update(readFileSync(join(directory, filename))).digest("hex");
  const lines = readFileSync(checksumPath, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => (line.endsWith(`  ${filename}`) ? `${digest}  ${filename}` : line));
  writeFileSync(checksumPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

describe("logical backup inventory", () => {
  it("includes every current application table without stale migration names", () => {
    expect(CORE_TABLES).toHaveLength(30);
    expect(CORE_TABLES.indexOf("message_delivery_receipts")).toBeGreaterThan(
      CORE_TABLES.indexOf("message_logs"),
    );
    expect(backupSource).toContain("buildMigrationHistoryEvidence");
    expect(backupSource).not.toContain("20260807052002_hometogether_auth_and_token_access");
    expect(backupSource).not.toContain("20260807052931_hometogether_auth_hardening");
    expect(backupSource).not.toContain("20260807071307_bootstrap_student_email_otp");
  });

  it("derives matched and mismatched migration history from version evidence", () => {
    const migrations = ["202608020001_initial.sql", "202608020002_security.sql"];
    expect(
      buildMigrationHistoryEvidence(migrations, ["202608020002", "202608020001"]).status,
    ).toBe("MATCHED");
    const mismatch = buildMigrationHistoryEvidence(migrations, ["202608020001", "202608030001"]);
    expect(mismatch.status).toBe("MISMATCHED");
    expect(mismatch.missingLocalSources).toEqual(["202608030001"]);
    expect(mismatch.pendingLocalVersions).toEqual(["202608020002"]);
    expect(mismatch.remoteOnlyCount).toBe(1);
    expect(mismatch.localOnlyCount).toBe(1);
  });

  it("allows only an explicitly mapped table introduced by a local-only migration", () => {
    const evidence = buildMigrationHistoryEvidence(
      [
        "202608020001_initial.sql",
        "20260809090828_harden_admin_privacy_and_message_receipts.sql",
      ],
      ["202608020001"],
    );
    expect(absentPendingMigrationTable("message_delivery_receipts", evidence)).toEqual({
      table: "message_delivery_receipts",
      introducedByMigration: "20260809090828",
    });
    expect(absentPendingMigrationTable("profiles", evidence)).toBeNull();
    expect(
      absentPendingMigrationTable(
        "message_delivery_receipts",
        buildMigrationHistoryEvidence(
          ["20260809090828_harden_admin_privacy_and_message_receipts.sql"],
          ["20260809090828"],
        ),
      ),
    ).toBeNull();
  });

  it("accepts the existing complete v2 checksum and file inventory", () => {
    const directory = createBackupFixture();
    try {
      expect(runVerifier(directory).status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts a v3 manifest with exact local and remote migration parity", () => {
    const directory = createBackupFixture({ format: LOGICAL_BACKUP_FORMAT });
    try {
      const result = runVerifier(directory);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        remoteMigrationHistoryComplete: true,
        migrationHistoryStatus: "MATCHED",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts an honest v3 mismatch without claiming parity", () => {
    const directory = createBackupFixture({
      format: LOGICAL_BACKUP_FORMAT,
      remoteVersions: ["202608020001", "202608030001"],
    });
    try {
      const result = runVerifier(directory);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        remoteMigrationHistoryComplete: false,
        migrationHistoryStatus: "MISMATCHED",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("accepts an absent remote table only when its introducing migration is local-only", () => {
    const directory = createBackupFixture({
      format: LOGICAL_BACKUP_FORMAT,
      remoteVersions: ["202608020001", "202608020002"],
      absentReceiptTable: true,
    });
    try {
      expect(runVerifier(directory).status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects migration bundle content that disagrees with the manifest", () => {
    const directory = createBackupFixture({ format: LOGICAL_BACKUP_FORMAT });
    try {
      const bundlePath = join(directory, "migrations.sql");
      writeFileSync(
        bundlePath,
        readFileSync(bundlePath, "utf8").replace("select 1;", "select 2;"),
        { mode: 0o600 },
      );
      refreshChecksum(directory, "migrations.sql");
      expect(runVerifier(directory).status).not.toBe(0);
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

  it("rejects a symlinked backup file", () => {
    const directory = createBackupFixture();
    try {
      unlinkSync(join(directory, "profiles.json"));
      symlinkSync(join(directory, "homes.json"), join(directory, "profiles.json"));
      expect(runVerifier(directory).status).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects hard-linked and overly broad backup files", () => {
    const hardLinkDirectory = createBackupFixture();
    const modeDirectory = createBackupFixture();
    try {
      unlinkSync(join(hardLinkDirectory, "profiles.json"));
      linkSync(
        join(hardLinkDirectory, "homes.json"),
        join(hardLinkDirectory, "profiles.json"),
      );
      expect(runVerifier(hardLinkDirectory).status).not.toBe(0);

      if (process.platform !== "win32") {
        chmodSync(join(modeDirectory, "profiles.json"), 0o644);
        expect(runVerifier(modeDirectory).status).not.toBe(0);
      }
    } finally {
      rmSync(hardLinkDirectory, { recursive: true, force: true });
      rmSync(modeDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked backup directory", () => {
    const directory = createBackupFixture();
    const link = join(dirname(directory), `${directory.split("/").at(-1)}-link`);
    try {
      symlinkSync(directory, link);
      expect(runVerifier(link).status).not.toBe(0);
    } finally {
      rmSync(link, { force: true });
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
