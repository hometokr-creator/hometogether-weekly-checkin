import { describe, expect, it, vi } from "vitest";

import { fetchAllSupabaseRows } from "@/lib/supabase/pagination";

describe("fetchAllSupabaseRows", () => {
  it("reads every row across the PostgREST max-row boundary", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) => ({ id: index + 1 }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    await expect(fetchAllSupabaseRows(fetchPage)).resolves.toEqual(source);
    expect(fetchPage.mock.calls).toEqual([
      [0, 499],
      [500, 999],
      [1_000, 1_499],
    ]);
  });

  it("fails closed instead of returning a partial result at the hard ceiling", async () => {
    const source = Array.from({ length: 6 }, (_, index) => ({ id: index + 1 }));
    const fetchPage = vi.fn(async (from: number, to: number) => ({
      data: source.slice(from, to + 1),
      error: null,
    }));

    await expect(
      fetchAllSupabaseRows(fetchPage, { pageSize: 2, maxRows: 4 }),
    ).rejects.toThrow("SUPABASE_PAGINATION_ROW_LIMIT_EXCEEDED");
    expect(fetchPage.mock.calls.at(-1)).toEqual([4, 4]);
  });

  it("propagates page errors without returning previously loaded rows", async () => {
    const databaseError = new Error("database unavailable");
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }], error: null })
      .mockResolvedValueOnce({ data: null, error: databaseError });

    await expect(
      fetchAllSupabaseRows(fetchPage, { pageSize: 2, maxRows: 10 }),
    ).rejects.toBe(databaseError);
  });
});
