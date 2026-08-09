import { z } from "zod";

const adminEmailSchema = z.string().trim().toLowerCase().email().max(254);
const MAX_CONFIGURED_ADMINS = 50;

export class AdminEmailConfigurationError extends Error {
  constructor() {
    super("ADMIN_EMAILS configuration is invalid");
    this.name = "AdminEmailConfigurationError";
  }
}

export function parseAdminEmails(
  configuredEmails: string | undefined,
  legacyEmail: string | undefined,
): string[] {
  const candidates = [
    ...(configuredEmails?.split(",") ?? []),
    ...(legacyEmail ? [legacyEmail] : []),
  ].filter((value) => value.trim().length > 0);

  if (candidates.length > MAX_CONFIGURED_ADMINS) {
    throw new AdminEmailConfigurationError();
  }

  const unique = new Set<string>();
  for (const candidate of candidates) {
    const parsed = adminEmailSchema.safeParse(candidate);
    if (!parsed.success) throw new AdminEmailConfigurationError();
    unique.add(parsed.data);
  }

  return [...unique];
}

export function getConfiguredAdminEmails(): string[] {
  return parseAdminEmails(process.env.ADMIN_EMAILS, process.env.ADMIN_EMAIL);
}

export function isConfiguredAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const parsed = adminEmailSchema.safeParse(email);
  return parsed.success && getConfiguredAdminEmails().includes(parsed.data);
}

export function getAdminEmailConfigurationSummary(): {
  configured: boolean;
  count: number;
  valid: boolean;
} {
  try {
    const emails = getConfiguredAdminEmails();
    return { configured: emails.length > 0, count: emails.length, valid: true };
  } catch {
    return { configured: true, count: 0, valid: false };
  }
}
