import { describe, expect, it } from "vitest";

import { requiredPermissionForCsv } from "@/lib/admin/exports";

describe("CSV export permissions", () => {
  it("requires SUPER_ADMIN for notification outbox metadata", () => {
    expect(requiredPermissionForCsv("notification-outbox")).toBe("SUPER_ADMIN");
  });

  it("keeps safety response exports behind SAFETY_READ", () => {
    expect(requiredPermissionForCsv("checkin-responses")).toBe("SAFETY_READ");
    expect(requiredPermissionForCsv("issues")).toBe("SAFETY_READ");
  });
});
