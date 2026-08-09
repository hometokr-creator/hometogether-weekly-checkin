import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));

describe("runOperationalHousekeeping", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("purges expired rate limits and redacts expired import staging rows", async () => {
    rpc
      .mockResolvedValueOnce({ data: 60, error: null })
      .mockResolvedValueOnce({ data: 3, error: null });

    const { runOperationalHousekeeping } = await import(
      "@/lib/jobs/operational-housekeeping"
    );
    await expect(runOperationalHousekeeping()).resolves.toEqual({
      expiredRateLimitBuckets: 60,
      expiredImportRowsRedacted: 3,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "purge_expired_rate_limits");
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "purge_expired_data_import_staging",
    );
  });

  it("fails closed without exposing a database error", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "sensitive" } })
      .mockResolvedValueOnce({ data: 0, error: null });

    const { runOperationalHousekeeping } = await import(
      "@/lib/jobs/operational-housekeeping"
    );
    await expect(runOperationalHousekeeping()).rejects.toThrow(
      "OPERATIONAL_HOUSEKEEPING_RATE_LIMIT_PURGE_FAILED",
    );
  });
});
