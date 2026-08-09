import { afterEach, describe, expect, it } from "vitest";

import {
  AdminEmailConfigurationError,
  getAdminEmailConfigurationSummary,
  parseAdminEmails,
} from "@/lib/auth/admin-config";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalLegacyEmail = process.env.ADMIN_EMAIL;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAdminEmails;
  if (originalLegacyEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalLegacyEmail;
});

describe("administrator email allowlist", () => {
  it("normalizes, merges, and deduplicates ADMIN_EMAILS with legacy ADMIN_EMAIL", () => {
    expect(
      parseAdminEmails(
        " First.Admin@Example.com,second@example.com, first.admin@example.com ",
        "legacy@example.com",
      ),
    ).toEqual([
      "first.admin@example.com",
      "second@example.com",
      "legacy@example.com",
    ]);
  });

  it("fails closed when any configured entry is invalid", () => {
    expect(() => parseAdminEmails("valid@example.com,not-an-email", undefined)).toThrow(
      AdminEmailConfigurationError,
    );
  });

  it("reports counts without returning configured addresses", () => {
    process.env.ADMIN_EMAILS = "one@example.com,two@example.com";
    delete process.env.ADMIN_EMAIL;
    expect(getAdminEmailConfigurationSummary()).toEqual({
      configured: true,
      count: 2,
      valid: true,
    });
  });
});
