import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsv } from "@/lib/imports/csv";
import { normalizeKoreanMobile } from "@/lib/imports/normalize";

describe("operational CSV primitives", () => {
  it.each([
    ["010-1234-5678", "+821012345678"],
    ["01012345678", "+821012345678"],
    ["+82 10 1234 5678", "+821012345678"],
    ["0082-10-1234-5678", "+821012345678"],
    ["02-1234-5678", null],
    ["", null],
  ])("normalizes Korean mobile %s", (input, expected) => {
    expect(normalizeKoreanMobile(input)).toBe(expected);
  });

  it("parses BOM, CRLF, quoted commas and escaped quotes", () => {
    const parsed = parseCsv('\uFEFFname,note\r\n"홍,길동","말씀 ""확인"""\r\n');
    expect(parsed).toEqual({
      headers: ["name", "note"],
      rows: [{ name: "홍,길동", note: '말씀 "확인"' }],
    });
  });

  it("rejects rows whose column count differs from the header", () => {
    expect(() => parseCsv("a,b\r\n1,2,3\r\n")).toThrow(CsvParseError);
    expect(() => parseCsv("a,b\r\n1\r\n")).toThrow("CSV 2행의 컬럼 수가 헤더와 다릅니다.");
  });
});
