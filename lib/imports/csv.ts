export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function parseCsv(input: string, maximumRows = 2_000): ParsedCsv {
  const source = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new CsvParseError("따옴표 앞의 CSV 값을 확인해 주세요.");
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new CsvParseError("닫히지 않은 CSV 따옴표가 있습니다.");
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }

  while (records.length > 0 && records.at(-1)?.every((value) => value.trim() === "")) {
    records.pop();
  }
  if (records.length === 0) throw new CsvParseError("CSV 헤더가 없습니다.");

  const headers = records[0].map((value) => value.trim());
  if (headers.some((header) => !header)) throw new CsvParseError("빈 CSV 헤더가 있습니다.");
  if (new Set(headers).size !== headers.length) throw new CsvParseError("중복 CSV 헤더가 있습니다.");

  const dataRows = records.slice(1);
  if (dataRows.length > maximumRows) {
    throw new CsvParseError(`한 번에 최대 ${maximumRows.toLocaleString("ko-KR")}행까지 가져올 수 있습니다.`);
  }
  const mismatchedRowIndex = dataRows.findIndex((values) => values.length !== headers.length);
  if (mismatchedRowIndex >= 0) {
    throw new CsvParseError(
      `CSV ${mismatchedRowIndex + 2}행의 컬럼 수가 헤더와 다릅니다.`,
    );
  }

  return {
    headers,
    rows: dataRows.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    ),
  };
}

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
