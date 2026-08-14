import { createHash } from "node:crypto";

import { parseCsv } from "@/lib/imports/csv";
import {
  leadCustomerTypes,
  leadSources,
  type CreateLeadInput,
} from "@/lib/leads/types";
import type { ImportLeadRow } from "@/lib/leads/repository";

const maximumRows = 500;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function optionalInteger(
  value: string | undefined,
  field: string,
  row: number,
): number | undefined {
  const normalized = optional(value)?.replaceAll(",", "");
  if (!normalized) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new LeadCsvError(`${row}행 ${field}은(는) 0 이상의 정수여야 합니다.`);
  }
  return Number(normalized);
}

function enumValue<T extends readonly string[]>(
  value: string | undefined,
  values: T,
  fallback: T[number],
  field: string,
  row: number,
): T[number] {
  const normalized = optional(value)
    ?.toUpperCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
  if (!normalized) return fallback;
  if ((values as readonly string[]).includes(normalized))
    return normalized as T[number];
  throw new LeadCsvError(`${row}행 ${field} 값을 확인해 주세요.`);
}

function tags(value: string | undefined): string[] {
  return (
    optional(value)
      ?.split("|")
      .map((item) => item.trim().toUpperCase().replaceAll(" ", "_"))
      .filter(Boolean) ?? []
  );
}

export class LeadCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadCsvError";
  }
}

export type LeadImportPreview = {
  fileSha256: string;
  rows: ImportLeadRow[];
  warnings: string[];
};

/**
 * Required columns: `record_id`. All additional columns are optional. Values
 * are deliberately explicit rather than inferred from a person's name or
 * contact data, so ambiguous historical Kakao records stay reviewable.
 */
export function parseLeadImportCsv(csv: string): LeadImportPreview {
  const parsed = parseCsv(csv, maximumRows);
  if (!parsed.headers.includes("record_id")) {
    throw new LeadCsvError("CSV에 중복 방지용 record_id 컬럼이 필요합니다.");
  }
  const seen = new Set<string>();
  const warnings: string[] = [];
  const rows = parsed.rows.map((raw, index) => {
    const rowNumber = index + 2;
    const recordId = optional(raw.record_id);
    if (!recordId || recordId.length > 160) {
      throw new LeadCsvError(`${rowNumber}행 record_id를 확인해 주세요.`);
    }
    if (seen.has(recordId))
      throw new LeadCsvError(`${rowNumber}행 record_id가 중복됩니다.`);
    seen.add(recordId);

    const source = enumValue(
      raw.source,
      leadSources,
      "KAKAO",
      "source",
      rowNumber,
    );
    const customerType = enumValue(
      raw.customer_type,
      leadCustomerTypes,
      "UNKNOWN",
      "customer_type",
      rowNumber,
    );
    const confidence = enumValue(
      raw.confidence,
      ["HIGH", "MEDIUM", "LOW"] as const,
      "LOW",
      "confidence",
      rowNumber,
    );
    const desiredMoveIn = optional(raw.desired_move_in);
    if (desiredMoveIn && !/^\d{4}-\d{2}-\d{2}$/.test(desiredMoveIn)) {
      throw new LeadCsvError(
        `${rowNumber}행 desired_move_in은 YYYY-MM-DD 형식이어야 합니다.`,
      );
    }
    const mustHave = tags(raw.must_have);
    if (!optional(raw.customer_label))
      warnings.push(
        `${rowNumber}행: 고객 식별자가 없어 운영 목록에 ID로 표시됩니다.`,
      );

    const input: CreateLeadInput = {
      customerLabel: optional(raw.customer_label),
      customerType,
      customerTags: tags(raw.customer_tags),
      source,
      sourceDetail: optional(raw.source_detail),
      utm: {
        source: optional(raw.utm_source),
        medium: optional(raw.utm_medium),
        campaign: optional(raw.utm_campaign),
        term: optional(raw.utm_term),
        content: optional(raw.utm_content),
      },
      landingPath: optional(raw.landing_path),
      desiredRegion: optional(raw.desired_region),
      desiredMoveIn,
      desiredTermMonths: optionalInteger(
        raw.desired_term_months,
        "desired_term_months",
        rowNumber,
      ),
      budgetMonthly: optionalInteger(
        raw.budget_monthly,
        "budget_monthly",
        rowNumber,
      ),
      budgetDeposit: optionalInteger(
        raw.budget_deposit,
        "budget_deposit",
        rowNumber,
      ),
      mustHave,
      originalListingId: optional(raw.original_listing_id),
    };
    return { ...input, importRecordId: recordId, confidence };
  });
  if (!rows.length) throw new LeadCsvError("가져올 CSV 행이 없습니다.");
  return { fileSha256: hash(csv.replace(/^\uFEFF/, "")), rows, warnings };
}
