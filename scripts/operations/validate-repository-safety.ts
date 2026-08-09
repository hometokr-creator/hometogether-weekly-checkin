import { execFileSync } from "node:child_process";

type ForbiddenRule = { label: string; pattern: RegExp };

const forbiddenRules: ForbiddenRule[] = [
  { label: "environment file", pattern: /(^|\/)\.env(?:\.|$)/ },
  { label: "archive", pattern: /\.zip$/i },
  { label: "dependency directory", pattern: /(^|\/)node_modules\// },
  { label: "Next.js output", pattern: /(^|\/)\.next\// },
  { label: "Supabase runtime state", pattern: /(^|\/)supabase\/\.temp\// },
  { label: "test output", pattern: /(^|\/)(test-results|playwright-report|coverage)\// },
  { label: "database backup", pattern: /\.(?:dump|backup|bak|sql\.gz|pgdump)$/i },
  { label: "private key", pattern: /\.(?:pem|key|p12|pfx)$/i },
  { label: "actual CSV", pattern: /\.csv$/i },
];

function allowedException(path: string, rule: ForbiddenRule): boolean {
  if (rule.label === "environment file" && path === ".env.example") return true;
  if (rule.label === "actual CSV" && /^docs\/examples\/[A-Za-z0-9._-]+\.csv$/.test(path)) {
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const failures: Array<{ path: string; risk: string }> = [];
  for (const path of files) {
    for (const rule of forbiddenRules) {
      if (rule.pattern.test(path) && !allowedException(path, rule)) {
        failures.push({ path, risk: rule.label });
      }
    }
  }

  const indexEntries = execFileSync("git", ["ls-files", "-s", "-z"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const entry of indexEntries) {
    const match = /^(\d+) [0-9a-f]+ \d+\t(.+)$/.exec(entry);
    if (match?.[1] === "120000") failures.push({ path: match[2], risk: "tracked symlink" });
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      process.stderr.write(`${failure.path}: ${failure.risk}\n`);
    }
    throw new Error("Forbidden tracked files were found.");
  }
  process.stdout.write(`${JSON.stringify({ ok: true, trackedFileCount: files.length })}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Repository safety validation failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
