import { describe, expect, it } from "vitest";

import {
  csvSafeCell,
  dateMatchesFilter,
  parseCsvExportFilters,
  serializeCsv,
  testFlagMatches,
} from "@/lib/admin/csv";

describe("administrator CSV", () => {
  it("adds an Excel-compatible UTF-8 BOM and preserves Korean text", () => {
    const csv = serializeCsv(["이름", "메모"], [["홍길동", "공용 공간 확인"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"홍길동"');
    expect(csv).toContain("\r\n");
  });

  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@cmd", "  =HYPERLINK()", "\t=1"])(
    "neutralizes formula-like cell %s",
    (value) => {
      expect(csvSafeCell(value)).toContain("'");
      expect(csvSafeCell(value)).not.toBe(`"${value}"`);
    },
  );

  it("quotes commas, quotes, and newlines", () => {
    expect(csvSafeCell('가,나"다\n라')).toBe('"가,나""다\n라"');
  });

  it("accepts only valid ISO date filters and bounded text filters", () => {
    const filters = parseCsvExportFilters(
      new URL(
        "https://example.test/api/admin/exports/checkin-responses?from=2026-08-01&to=bad&risk=RED&includeTest=only",
      ),
    );
    expect(filters).toMatchObject({ from: "2026-08-01", risk: "RED", includeTest: "only" });
    expect(filters.to).toBeUndefined();
  });

  it("applies date and authoritative test-data filters", () => {
    expect(dateMatchesFilter("2026-08-07T10:00:00Z", { from: "2026-08-01", to: "2026-08-07" })).toBe(true);
    expect(dateMatchesFilter("2026-08-08T00:00:00Z", { to: "2026-08-07" })).toBe(false);
    expect(testFlagMatches(false, undefined)).toBe(true);
    expect(testFlagMatches(true, undefined)).toBe(false);
    expect(testFlagMatches(true, "only")).toBe(true);
  });
});
