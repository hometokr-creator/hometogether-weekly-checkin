import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Produces a relay-retry-safe 256-bit opaque token. The context contains only
 * non-secret IDs; security comes from a high-entropy server-only secret. This
 * lets a crashed sender recreate the URL while the database still stores only
 * SHA-256(token).
 */
export function createOpaqueTokenForContext(context: string): string {
  const secret = process.env.CHECKIN_TOKEN_SECRET ?? process.env.TOKEN_HASH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CHECKIN_TOKEN_SECRET or TOKEN_HASH_SECRET is required in production");
    }
    return createHmac("sha256", "development-checkin-token-only")
      .update(context)
      .digest("base64url");
  }
  if (secret.length < 32) throw new Error("The check-in token secret must be at least 32 characters");
  return createHmac("sha256", secret).update(context).digest("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenHashMatches(token: string, expectedHexHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHexHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * The product rule is interpreted as "until the end of Wednesday in Korea",
 * i.e. the next Thursday 00:00 Asia/Seoul, capped at seven days from creation.
 */
export function calculateInvitationExpiry(createdAt: Date): Date {
  const kstEquivalent = new Date(createdAt.getTime() + KST_OFFSET_MS);
  const localDay = kstEquivalent.getUTCDay();
  let daysUntilThursday = (4 - localDay + 7) % 7;

  const thursdayLocalMidnightEquivalent = new Date(
    Date.UTC(
      kstEquivalent.getUTCFullYear(),
      kstEquivalent.getUTCMonth(),
      kstEquivalent.getUTCDate() + daysUntilThursday,
    ),
  );
  let deadline = new Date(thursdayLocalMidnightEquivalent.getTime() - KST_OFFSET_MS);

  if (deadline.getTime() <= createdAt.getTime()) {
    daysUntilThursday += 7;
    deadline = new Date(
      Date.UTC(
        kstEquivalent.getUTCFullYear(),
        kstEquivalent.getUTCMonth(),
        kstEquivalent.getUTCDate() + daysUntilThursday,
      ) - KST_OFFSET_MS,
    );
  }

  const sevenDaysLater = new Date(createdAt.getTime() + 7 * DAY_MS);
  return deadline.getTime() < sevenDaysLater.getTime() ? deadline : sevenDaysLater;
}

export function isUsableTokenFormat(token: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(token);
}
