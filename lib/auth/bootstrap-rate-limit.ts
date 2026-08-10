import "server-only";

import { createHmac } from "node:crypto";

import { hasSupabaseServerConfig } from "@/lib/checkin/repository-factory";
import { createAdminClient } from "@/lib/supabase/admin";

interface LocalBucket {
  count: number;
  resetsAt: number;
}

const localBuckets = new Map<string, LocalBucket>();

function privacyHash(value: string): string {
  const secret =
    process.env.RATE_LIMIT_HMAC_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "development-bootstrap-rate-limit");
  if (!secret) throw new Error("RATE_LIMIT_HMAC_SECRET is required in production");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function consumeLocal(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const existing = localBuckets.get(key);
  if (!existing || existing.resetsAt <= now) {
    localBuckets.set(key, { count: 1, resetsAt: now + windowSeconds * 1000 });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

/** A bootstrap-only bucket; it never shares capacity with public check-ins. */
export async function consumeAdminBootstrapRateLimit(input: {
  clientAddress: string;
  limit?: number;
  windowSeconds?: number;
}): Promise<boolean> {
  const limit = input.limit ?? 5;
  const windowSeconds = input.windowSeconds ?? 15 * 60;
  const route = "admin-bootstrap";
  const bucketKey = privacyHash(`${route}:${input.clientAddress}`);

  if (hasSupabaseServerConfig()) {
    const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
      p_bucket_key: bucketKey,
      p_route: route,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return Array.isArray(data) && data[0]?.allowed === true;
  }

  if (process.env.NODE_ENV === "production") return false;
  return consumeLocal(`${route}:${bucketKey}`, limit, windowSeconds);
}
