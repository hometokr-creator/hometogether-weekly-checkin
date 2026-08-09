import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const rawDirectory = argument("--directory");
  if (!rawDirectory || !isAbsolute(rawDirectory)) {
    throw new Error("Pass the absolute backup directory with --directory.");
  }
  const directory = resolve(rawDirectory);
  if (!(await stat(directory)).isDirectory()) throw new Error("Backup path is not a directory.");

  const checksumText = await readFile(join(directory, "SHA256SUMS"), "utf8");
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

  for (const entry of entries) {
    const actual = createHash("sha256")
      .update(await readFile(join(directory, entry.filename)))
      .digest("hex");
    if (actual !== entry.expected) throw new Error(`Checksum mismatch: ${entry.filename}`);
  }

  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (
    manifest.format !== "hometogether-logical-backup-v1" &&
    manifest.format !== "hometogether-logical-backup-v2"
  ) {
    throw new Error("Unsupported logical backup format.");
  }
  if (manifest.format === "hometogether-logical-backup-v2") {
    if (manifest.applicationTableCount !== 29 || Object.keys(manifest.counts ?? {}).length !== 29) {
      throw new Error("Logical backup application table inventory is incomplete.");
    }
    if (manifest.remoteMigrationHistoryComplete !== false) {
      throw new Error("Logical backup migration-history disclosure is invalid.");
    }
    if (
      !Array.isArray(manifest.knownRemoteOnlyMigrations) ||
      manifest.knownRemoteOnlyMigrations.length !== 3
    ) {
      throw new Error("Logical backup remote-only migration inventory is incomplete.");
    }
    const expectedDataFiles = [
      ...Object.keys(manifest.counts).map((table) => `${table}.json`),
      "auth-users.json",
      "migrations.sql",
    ].sort();
    if (JSON.stringify(manifest.dataFiles) !== JSON.stringify(expectedDataFiles)) {
      throw new Error("Logical backup data-file manifest is incomplete.");
    }
    const expectedChecksummedFiles = [
      ...expectedDataFiles,
      "database.types.ts",
      "manifest.json",
    ].sort();
    const checksummedFiles = entries.map((entry) => entry.filename).sort();
    const directoryFiles = (await readdir(directory))
      .filter((filename) => filename !== "SHA256SUMS")
      .sort();
    if (
      JSON.stringify(checksummedFiles) !== JSON.stringify(expectedChecksummedFiles) ||
      JSON.stringify(directoryFiles) !== JSON.stringify(expectedChecksummedFiles)
    ) {
      throw new Error("Logical backup checksum inventory does not match the directory.");
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      filesVerified: entries.length,
      format: manifest.format,
      remoteMigrationHistoryComplete: manifest.remoteMigrationHistoryComplete ?? false,
    })}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Backup verification failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
