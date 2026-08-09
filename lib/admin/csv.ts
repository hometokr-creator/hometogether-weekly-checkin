export const csvDatasets = [
  "profiles",
  "hosts",
  "guests",
  "homes",
  "active-matches",
  "matches",
  "weekly-checkins",
  "checkin-responses",
  "issues",
  "notification-outbox",
] as const;

export type CsvDataset = (typeof csvDatasets)[number];
export type CsvCell = string | number | boolean | null | undefined;

export type CsvExportFilters = {
  from?: string;
  to?: string;
  week?: string;
  role?: string;
  risk?: string;
  status?: string;
  match?: string;
  responseState?: string;
  category?: string;
  desiredAction?: string;
  caseStatus?: string;
  assignee?: string;
  includeTest?: "true" | "only";
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string | null): string | undefined {
  if (!value || !isoDatePattern.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function shortValue(value: string | null, max = 128): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length <= max ? normalized : undefined;
}

export function parseCsvExportFilters(url: URL): CsvExportFilters {
  const includeTest = url.searchParams.get("includeTest");
  const from = validIsoDate(url.searchParams.get("from"));
  const to = validIsoDate(url.searchParams.get("to"));
  return {
    from,
    to,
    week: shortValue(url.searchParams.get("week"), 80),
    role: shortValue(url.searchParams.get("role"), 20),
    risk: shortValue(url.searchParams.get("risk"), 20),
    status: shortValue(url.searchParams.get("status"), 40),
    match: shortValue(url.searchParams.get("match")),
    responseState: shortValue(url.searchParams.get("responseState"), 40),
    category: shortValue(url.searchParams.get("category"), 80),
    desiredAction: shortValue(url.searchParams.get("desiredAction"), 80),
    caseStatus: shortValue(url.searchParams.get("caseStatus"), 40),
    assignee: shortValue(url.searchParams.get("assignee")),
    includeTest:
      includeTest === "true" || includeTest === "only" ? includeTest : undefined,
  };
}

export function csvSafeCell(value: CsvCell): string {
  let text = value == null ? "" : String(value);
  // Excel can evaluate formulas even after leading whitespace. Tabs and line
  // breaks at the beginning are also treated as dangerous control prefixes.
  if (/^[\t\r\n]/.test(text) || /^\s*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [
    headers.map(csvSafeCell).join(","),
    ...rows.map((row) => row.map(csvSafeCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function isCsvDataset(value: string): value is CsvDataset {
  return (csvDatasets as readonly string[]).includes(value);
}

export function dateMatchesFilter(
  isoTimestamp: unknown,
  filters: Pick<CsvExportFilters, "from" | "to">,
): boolean {
  if (!filters.from && !filters.to) return true;
  if (typeof isoTimestamp !== "string" || isoTimestamp.length < 10) return false;
  const date = isoTimestamp.slice(0, 10);
  return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}

export function testFlagMatches(value: unknown, mode: CsvExportFilters["includeTest"]): boolean {
  const isTest = value === true;
  if (mode === "true") return true;
  if (mode === "only") return isTest;
  return !isTest;
}
