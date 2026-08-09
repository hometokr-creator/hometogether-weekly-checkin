import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { hasSupabaseServerConfig } from "@/lib/checkin/repository-factory";
import { createAdminClient } from "@/lib/supabase/admin";

interface LocalBucket {
  count: number;
  resetsAt: number;
}

type CheckinRateLimitScope = "lookup" | "draft" | "submit";

const localBuckets = new Map<string, LocalBucket>();

const CLOUDFLARE_IPV4_RANGES = [
  ["173.245.48.0", 20],
  ["103.21.244.0", 22],
  ["103.22.200.0", 22],
  ["103.31.4.0", 22],
  ["141.101.64.0", 18],
  ["108.162.192.0", 18],
  ["190.93.240.0", 20],
  ["188.114.96.0", 20],
  ["197.234.240.0", 22],
  ["198.41.128.0", 17],
  ["162.158.0.0", 15],
  ["104.16.0.0", 13],
  ["104.24.0.0", 14],
  ["172.64.0.0", 13],
  ["131.0.72.0", 22],
] as const;

const CLOUDFLARE_IPV6_RANGES = [
  ["2400:cb00::", 32],
  ["2606:4700::", 32],
  ["2803:f800::", 32],
  ["2405:b500::", 32],
  ["2405:8100::", 32],
  ["2a06:98c0::", 29],
  ["2c0f:f248::", 32],
] as const;

function privacyHash(value: string): string {
  const secret =
    process.env.RATE_LIMIT_HMAC_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "development-rate-limit-only");
  if (!secret) throw new Error("RATE_LIMIT_HMAC_SECRET is required in production");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function normalizedIp(value: string | null | undefined): string | null {
  const candidate = value?.trim().toLowerCase();
  return candidate && isIP(candidate) ? candidate : null;
}

function firstForwardedIp(value: string | null): string | null {
  if (!value) return null;
  for (const part of value.split(",")) {
    const candidate = normalizedIp(part);
    if (candidate) return candidate;
  }
  return null;
}

function ipv4Number(value: string): number | null {
  if (isIP(value) !== 4) return null;
  return value
    .split(".")
    .map(Number)
    .reduce((result, part) => (result * 256 + part) >>> 0, 0);
}

function ipv6Parts(value: string): number[] | null {
  if (isIP(value) !== 6) return null;
  const [leftValue, rightValue] = value.toLowerCase().split("::");
  const left = leftValue ? leftValue.split(":") : [];
  const right = rightValue ? rightValue.split(":") : [];
  if (!value.includes("::") && left.length !== 8) return null;
  const zeroCount = value.includes("::") ? 8 - left.length - right.length : 0;
  if (zeroCount < 0) return null;
  const parts = [...left, ...Array.from({ length: zeroCount }, () => "0"), ...right];
  if (parts.length !== 8) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isCloudflareSource(value: string): boolean {
  const version = isIP(value);
  if (version === 4) {
    const source = ipv4Number(value)!;
    return CLOUDFLARE_IPV4_RANGES.some(([networkValue, prefix]) => {
      const network = ipv4Number(networkValue)!;
      const hostBits = 32 - prefix;
      return (source >>> hostBits) === (network >>> hostBits);
    });
  }
  if (version === 6) {
    const source = ipv6Parts(value)!;
    return CLOUDFLARE_IPV6_RANGES.some(([networkValue, prefix]) => {
      const network = ipv6Parts(networkValue)!;
      const completeParts = Math.floor(prefix / 16);
      for (let index = 0; index < completeParts; index += 1) {
        if (source[index] !== network[index]) return false;
      }
      const remainingBits = prefix % 16;
      if (remainingBits === 0) return true;
      const mask = (0xffff << (16 - remainingBits)) & 0xffff;
      return (source[completeParts]! & mask) === (network[completeParts]! & mask);
    });
  }
  return false;
}

function configuredCheckinHostnames(): Set<string> {
  const hostnames = new Set<string>();
  const customDomain = process.env.CUSTOM_CHECKIN_DOMAIN?.trim().toLowerCase();
  if (customDomain && /^[a-z0-9.-]+$/.test(customDomain)) {
    hostnames.add(customDomain.replace(/\.$/, ""));
  }
  const publicBaseUrl = process.env.PUBLIC_CHECKIN_BASE_URL?.trim();
  if (publicBaseUrl) {
    try {
      hostnames.add(new URL(publicBaseUrl).hostname.toLowerCase());
    } catch {
      // Invalid deployment configuration must not make a request header trusted.
    }
  }
  return hostnames;
}

/**
 * Vercel replaces X-Forwarded-For when another proxy is in front. For the
 * configured Cloudflare hostname, trust CF-Connecting-IP only when Vercel's
 * immediate source is in Cloudflare's published ranges. Direct vercel.app
 * traffic and spoofed Cloudflare headers therefore keep Vercel's edge IP.
 */
export function extractClientAddress(headers: Headers, requestUrl?: string): string {
  const edgeSource =
    normalizedIp(headers.get("x-real-ip")) ??
    firstForwardedIp(headers.get("x-vercel-forwarded-for")) ??
    firstForwardedIp(headers.get("x-forwarded-for"));
  let hostname = headers.get("host")?.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!hostname && requestUrl) {
    try {
      hostname = new URL(requestUrl).hostname.toLowerCase();
    } catch {
      hostname = "";
    }
  }

  if (
    edgeSource &&
    isCloudflareSource(edgeSource) &&
    configuredCheckinHostnames().has(hostname)
  ) {
    const cloudflareVisitor = normalizedIp(headers.get("cf-connecting-ip"));
    if (cloudflareVisitor) return cloudflareVisitor;
  }

  return edgeSource ?? "unknown";
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
  scope: CheckinRateLimitScope;
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

/**
 * Bounds token rotation and prevents an arbitrary token from creating one DB
 * bucket per request. Routes call this before any invitation lookup, then use
 * the token-specific limiter only after the token is known to exist.
 */
export async function consumePublicIpRateLimit(input: {
  clientAddress: string;
  scope: CheckinRateLimitScope;
  limit: number;
  windowSeconds?: number;
}): Promise<boolean> {
  const windowSeconds = input.windowSeconds ?? 60;
  const bucketKey = privacyHash(`public-checkin:${input.clientAddress}:${input.scope}`);
  const route = `public-checkin:${input.scope}:ip`;

  if (hasSupabaseServerConfig()) {
    const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
      p_bucket_key: bucketKey,
      p_route: route,
      p_limit: input.limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return Array.isArray(data) && data[0]?.allowed === true;
  }

  if (process.env.NODE_ENV === "production") return false;
  return consumeLocal(`${route}:${bucketKey}`, input.limit, windowSeconds);
}
