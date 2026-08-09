import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type OperationalHousekeepingSummary = {
  expiredRateLimitBuckets: number;
  expiredImportRowsRedacted: number;
};

function normalizedCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/**
 * Removes only rows that the database has already marked as expired. The
 * import RPC redacts staged PII instead of deleting the audit shell.
 */
export async function runOperationalHousekeeping(): Promise<OperationalHousekeepingSummary> {
  const supabase = createAdminClient();
  const [rateLimits, importRows] = await Promise.all([
    supabase.rpc("purge_expired_rate_limits"),
    supabase.rpc("purge_expired_data_import_staging"),
  ]);

  if (rateLimits.error) {
    throw new Error("OPERATIONAL_HOUSEKEEPING_RATE_LIMIT_PURGE_FAILED");
  }
  if (importRows.error) {
    throw new Error("OPERATIONAL_HOUSEKEEPING_IMPORT_PURGE_FAILED");
  }

  return {
    expiredRateLimitBuckets: normalizedCount(rateLimits.data),
    expiredImportRowsRedacted: normalizedCount(importRows.data),
  };
}
