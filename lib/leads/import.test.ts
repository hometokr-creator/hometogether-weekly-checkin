import { describe, expect, it } from "vitest";

import { LeadCsvError, parseLeadImportCsv } from "@/lib/leads/import";

describe("parseLeadImportCsv", () => {
  it("keeps an exact source record and confidence for a historical Kakao case", () => {
    const result = parseLeadImportCsv(
      "record_id,customer_label,source,desired_term_months,confidence\nold-100,김OO,kakao,3,medium\n",
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        importRecordId: "old-100",
        customerLabel: "김OO",
        source: "KAKAO",
        desiredTermMonths: 3,
        confidence: "MEDIUM",
      }),
    ]);
  });

  it("rejects a duplicate source record instead of guessing", () => {
    expect(() => parseLeadImportCsv("record_id\na\na\n")).toThrow(LeadCsvError);
  });
});
