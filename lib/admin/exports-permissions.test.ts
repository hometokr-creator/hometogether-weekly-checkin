import { describe, expect, it } from "vitest";

import { requiredPermissionsForCsv } from "@/lib/admin/exports";

describe("CSV export permissions", () => {
  it("requires SUPER_ADMIN for notification outbox metadata", () => {
    expect(requiredPermissionsForCsv("notification-outbox")).toEqual([
      "SUPER_ADMIN",
    ]);
  });

  it("requires both export and safety access for raw response-bearing exports", () => {
    expect(requiredPermissionsForCsv("weekly-checkins")).toEqual([
      "DATA_EXPORT",
    ]);
    expect(requiredPermissionsForCsv("checkin-responses")).toEqual([
      "DATA_EXPORT",
      "SAFETY_READ",
    ]);
    expect(requiredPermissionsForCsv("issues")).toEqual([
      "DATA_EXPORT",
      "SAFETY_READ",
    ]);
  });
});
