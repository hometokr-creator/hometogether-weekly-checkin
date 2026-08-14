import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function secret(): string {
  const value = process.env.LEAD_PUBLIC_TOKEN_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("LEAD_PUBLIC_TOKEN_SECRET must be at least 32 characters.");
  }
  return value;
}

function signature(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createPublicLeadToken(
  leadId: string,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ leadId, expiresAt }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyPublicLeadToken(
  token: string,
  expectedLeadId: string,
  now = Date.now(),
): boolean {
  const [payload, providedSignature, ...extra] = token.split(".");
  if (!payload || !providedSignature || extra.length) return false;
  const expectedSignature = signature(payload);
  const given = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return false;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      leadId?: unknown;
      expiresAt?: unknown;
    };
    return (
      value.leadId === expectedLeadId &&
      typeof value.expiresAt === "number" &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt > Math.floor(now / 1000)
    );
  } catch {
    return false;
  }
}
