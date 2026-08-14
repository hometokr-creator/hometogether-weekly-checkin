import "server-only";

import { createHmac } from "node:crypto";

import { hasSupabaseServerConfig } from "@/lib/checkin/repository-factory";
import { createAdminClient } from "@/lib/supabase/admin";

function requestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export async function isPublicLeadRequestAllowed(
  request: Request,
  route: string,
  limit: number,
): Promise<boolean> {
  if (!hasSupabaseServerConfig()) return process.env.NODE_ENV !== "production";
  const secret = process.env.RATE_LIMIT_HMAC_SECRET?.trim();
  if (!secret) return false;
  const bucketKey = createHmac("sha256", secret)
    .update(`${route}:${requestIp(request)}`)
    .digest("hex");
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_route: route,
    p_limit: limit,
    p_window_seconds: 3_600,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  return Boolean(
    result &&
    typeof result === "object" &&
    "allowed" in result &&
    result.allowed === true,
  );
}
