import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const SAFE_BACKUP_FILENAME = /^[A-Za-z0-9._-]+$/;

export type SafeBackupDirectory = {
  path: string;
  filenames: string[];
};

export function assertSafeBackupFilename(filename: string): void {
  if (
    !SAFE_BACKUP_FILENAME.test(filename) ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\")
  ) {
    throw new Error("Unsafe filename in logical backup inventory.");
  }
}

export async function inspectSafeBackupDirectory(rawDirectory: string): Promise<SafeBackupDirectory> {
  if (!isAbsolute(rawDirectory)) {
    throw new Error("Logical backup directory must be an absolute path.");
  }
  const directory = resolve(rawDirectory);
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("Logical backup path must be a real directory, not a symlink.");
  }
  if (process.platform !== "win32" && (directoryStat.mode & 0o077) !== 0) {
    throw new Error("Logical backup directory permissions must deny group and other access.");
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    assertSafeBackupFilename(entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Logical backup contains a non-regular entry: ${entry.name}`);
    }
    const entryStat = await lstat(join(directory, entry.name));
    if (process.platform !== "win32" && (entryStat.mode & 0o077) !== 0) {
      throw new Error(`Logical backup file permissions are too broad: ${entry.name}`);
    }
  }
  return { path: directory, filenames: entries.map((entry) => entry.name).sort() };
}

export async function readSafeBackupFile(
  directory: SafeBackupDirectory,
  filename: string,
): Promise<Buffer> {
  assertSafeBackupFilename(filename);
  if (!directory.filenames.includes(filename)) {
    throw new Error(`Logical backup file is missing: ${filename}`);
  }

  const handle = await open(
    join(directory.path, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.nlink !== 1) {
      throw new Error(`Logical backup entry is not an isolated regular file: ${filename}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
