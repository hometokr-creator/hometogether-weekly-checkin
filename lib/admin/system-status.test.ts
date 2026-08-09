import { describe, expect, it } from "vitest";

import { systemStatusInternals } from "@/lib/admin/system-status";

describe("System Status helpers", () => {
  it("uses Monday as the KST weekly boundary", () => {
    expect(
      systemStatusInternals.currentKoreanWeekStart(
        new Date("2026-08-09T16:00:00.000Z"),
      ),
    ).toBe("2026-08-10");
    expect(
      systemStatusInternals.currentKoreanWeekStart(
        new Date("2026-08-09T14:59:59.000Z"),
      ),
    ).toBe("2026-08-03");
  });

  it("never infers managed backup health from an unknown value", () => {
    expect(systemStatusInternals.envManagedStatus("enabled")).toBe("ENABLED");
    expect(systemStatusInternals.envManagedStatus("disabled")).toBe("DISABLED");
    expect(systemStatusInternals.envManagedStatus(undefined)).toBe("UNKNOWN");
    expect(systemStatusInternals.envManagedStatus("probably")).toBe("UNKNOWN");
  });

  it("reports a database error when every core query fails", () => {
    const rejected = { status: "rejected", reason: new Error("hidden") } as const;
    expect(
      systemStatusInternals.databaseStateFromSettled(
        [rejected, rejected],
        [rejected, rejected],
      ),
    ).toEqual({ state: "ERROR", connected: false, degraded: true });
  });

  it("reports degradation when at least one database query still succeeds", () => {
    const fulfilled = { status: "fulfilled", value: 1 } as const;
    const rejected = { status: "rejected", reason: new Error("hidden") } as const;
    expect(
      systemStatusInternals.databaseStateFromSettled(
        [fulfilled, rejected],
        [fulfilled, rejected],
      ),
    ).toEqual({ state: "WARNING", connected: true, degraded: true });
  });
});
