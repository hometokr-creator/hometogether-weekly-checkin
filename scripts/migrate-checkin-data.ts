import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { createDefaultColumnMapping } from "@/lib/imports/contracts";
import { parseCsv } from "@/lib/imports/csv";
import {
  applyOperationalDataImportWithClient,
  previewOperationalDataImportWithClient,
} from "@/lib/imports/service-role-operations";

type Arguments = {
  file?: string;
  apply: boolean;
  dryRun: boolean;
  confirm?: string;
  adminId?: string;
};

function usage(): never {
  process.stderr.write(
    "Usage: pnpm migrate:checkin-data -- --file <csv> [--dry-run] | [--apply --confirm <plan-sha256> --admin-id <uuid>]\n",
  );
  process.exit(2);
}

function parseArguments(values: string[]): Arguments {
  const result: Arguments = { apply: false, dryRun: true };
  let sawApply = false;
  let sawDryRun = false;
  const nextValue = (index: number): string => {
    const value = values[index + 1];
    if (!value || value.startsWith("--")) usage();
    return value;
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    // pnpm preserves the conventional argument separator for this script.
    if (value === "--" && index === 0) continue;
    if (value === "--file") result.file = nextValue(index++);
    else if (value === "--apply") {
      sawApply = true;
      result.apply = true;
      result.dryRun = false;
    } else if (value === "--dry-run") {
      sawDryRun = true;
      result.dryRun = true;
    } else if (value === "--confirm") result.confirm = nextValue(index++);
    else if (value === "--admin-id") result.adminId = nextValue(index++);
    else usage();
  }
  if (
    !result.file ||
    (sawApply && sawDryRun) ||
    (!result.apply && Boolean(result.confirm || result.adminId))
  ) usage();
  return result;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function createCliAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secretKey) throw new Error("SUPABASE_ADMIN_CONFIGURATION_REQUIRED");
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const filePath = resolve(args.file!);
  const csv = await readFile(filePath, "utf8");
  if (Buffer.byteLength(csv, "utf8") > 2_000_000) {
    throw new Error("CSV_TOO_LARGE");
  }
  const parsed = parseCsv(csv);
  const mapping = createDefaultColumnMapping(parsed.headers);
  const supabase = createCliAdminClient();
  const plan = await previewOperationalDataImportWithClient(supabase, { csv, mapping });

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        fileSha256: plan.fileSha256,
        planSha256: plan.planSha256,
        canApply: plan.canApply,
        counts: plan.counts,
        issues: plan.issues.slice(0, 200).map((issue) => ({
          rowNumber: issue.rowNumber,
          field: issue.field,
          code: issue.code,
          severity: issue.severity,
        })),
      },
      null,
      2,
    )}\n`,
  );

  if (!args.apply) return;
  if (!plan.canApply) throw new Error("IMPORT_PLAN_HAS_ERRORS");
  if (!args.confirm || args.confirm !== plan.planSha256) {
    throw new Error("CONFIRM_PLAN_SHA256_REQUIRED");
  }
  const adminId = args.adminId ?? process.env.IMPORT_ADMIN_USER_ID;
  if (!isUuid(adminId)) throw new Error("VALID_SUPER_ADMIN_ID_REQUIRED");

  const result = await applyOperationalDataImportWithClient(supabase, {
    adminId,
    fileName: basename(filePath),
    plan,
  });
  process.stdout.write(
    `${JSON.stringify({
      applied: true,
      batchId: result.batchId,
      alreadyApplied: result.alreadyApplied,
      counts: result.counts,
    })}\n`,
  );
}

main().catch((error) => {
  // CSV rows may contain personal data. Never echo an exception message or
  // stack because provider/database errors can embed a rejected row value.
  process.stderr.write(
    `${JSON.stringify({ ok: false, errorName: error instanceof Error ? error.name : "UnknownError" })}\n`,
  );
  process.exit(1);
});
