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
    (process.env.NODE_ENV === "production" ? undefined : "development-rate-limit-only");
  if (!secret) throw new Error("RATE_LIMIT_HMAC_SECRET is required in production");
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function extractClientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
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

/**
 * Uses Postgres in production so separate serverless instances share limits.
 * The local map is development/test-only and is never selected in production.
 */
export async function consumeCheckinRateLimit(input: {
  tokenHash: string;
  clientAddress: string;
  scope: "lookup" | "draft" | "submit";
  limit?: number;
  windowSeconds?: number;
}): Promise<boolean> {
  const limit = input.limit ?? 20;
  const windowSeconds = input.windowSeconds ?? 60;
  const ipHash = privacyHash(`${input.clientAddress}:${input.scope}`);

  if (hasSupabaseServerConfig()) {
    const { data, error } = await createAdminClient().rpc("consume_checkin_rate_limit", {
      p_token_hash: input.tokenHash,
      p_ip_hash: ipHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data === true;
  }

  if (process.env.NODE_ENV === "production") return false;
  return consumeLocal(`${input.tokenHash}:${ipHash}`, limit, windowSeconds);
}
