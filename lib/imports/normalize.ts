import {
  importFieldNames,
  requiredImportFields,
  type ImportColumnMapping,
  type ImportContractStatus,
  type ImportFieldName,
  type ImportIssue,
  type NormalizedImportRow,
} from "@/lib/imports/contracts";

const statusMap: Record<string, ImportContractStatus> = {
  active: "ACTIVE",
  pending: "PENDING",
  move_out_scheduled: "MOVE_OUT_SCHEDULED",
  ended: "ENDED",
  cancelled: "CANCELLED",
};

function text(value: unknown, maximum = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeKoreanMobile(value: unknown): string | null {
  const raw = text(value, 80);
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0082")) digits = digits.slice(4);
  else if (digits.startsWith("82")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^10[0-9]{8}$/.test(digits) ? `+82${digits}` : null;
}

export function maskKoreanMobile(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `010-****-${digits.slice(-4)}` : "***";
}

function normalizeEmail(value: unknown): string | null {
  const normalized = text(value, 254).toLowerCase();
  return normalized || null;
}

function parseBoolean(value: unknown): boolean | null {
  const normalized = text(value, 20).toLowerCase();
  if (["true", "1", "y", "yes", "예"].includes(normalized)) return true;
  if (["false", "0", "n", "no", "아니오"].includes(normalized)) return false;
  return null;
}

function normalizeDate(value: unknown): string | null {
  const normalized = text(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function addIssue(
  issues: ImportIssue[],
  rowNumber: number,
  field: ImportFieldName | "row",
  code: string,
  message: string,
  severity: "ERROR" | "WARNING" = "ERROR",
) {
  issues.push({ rowNumber, field, code, message, severity });
}

export function validateColumnMapping(
  headers: readonly string[],
  mapping: ImportColumnMapping,
): ImportIssue[] {
  const headerSet = new Set(headers);
  const issues: ImportIssue[] = [];
  for (const field of importFieldNames) {
    const header = mapping[field]?.trim();
    if ((requiredImportFields as readonly string[]).includes(field) && !header) {
      addIssue(issues, 1, field, "MISSING_COLUMN_MAPPING", "필수 컬럼을 연결해 주세요.");
    } else if (header && !headerSet.has(header)) {
      addIssue(issues, 1, field, "UNKNOWN_COLUMN_MAPPING", "CSV에 없는 컬럼입니다.");
    }
  }
  const mappedHeaders = importFieldNames
    .map((field) => ({ field, header: mapping[field]?.trim() }))
    .filter((entry): entry is { field: ImportFieldName; header: string } => Boolean(entry.header));
  for (const entry of mappedHeaders) {
    if (mappedHeaders.filter((candidate) => candidate.header === entry.header).length > 1) {
      addIssue(
        issues,
        1,
        entry.field,
        "DUPLICATE_COLUMN_MAPPING",
        "하나의 CSV 컬럼을 여러 필드에 연결할 수 없습니다.",
      );
    }
  }
  return issues;
}

function mappedValue(
  raw: Record<string, string>,
  mapping: ImportColumnMapping,
  field: ImportFieldName,
): string {
  const header = mapping[field];
  return header ? raw[header] ?? "" : "";
}

export function normalizeImportRows(
  rawRows: Array<Record<string, string>>,
  mapping: ImportColumnMapping,
  asOfDate: string,
): { rows: NormalizedImportRow[]; issues: ImportIssue[] } {
  const rows: NormalizedImportRow[] = [];
  const issues: ImportIssue[] = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const value = (field: ImportFieldName) => mappedValue(raw, mapping, field);
    const required = (field: ImportFieldName, maximum = 160) => {
      const normalized = text(value(field), maximum);
      if (!normalized) addIssue(issues, rowNumber, field, "MISSING_REQUIRED", "필수값이 없습니다.");
      return normalized;
    };

    const status = statusMap[text(value("contract_status"), 40).toLowerCase()];
    if (!status) {
      addIssue(issues, rowNumber, "contract_status", "INVALID_STATUS", "지원하지 않는 계약 상태입니다.");
    }
    const startDate = normalizeDate(value("contract_start_date"));
    if (!startDate) {
      addIssue(issues, rowNumber, "contract_start_date", "INVALID_DATE", "YYYY-MM-DD 날짜가 필요합니다.");
    }
    const rawEndDate = text(value("contract_end_date"), 20);
    const endDate = rawEndDate ? normalizeDate(rawEndDate) : null;
    if (rawEndDate && !endDate) {
      addIssue(issues, rowNumber, "contract_end_date", "INVALID_DATE", "YYYY-MM-DD 날짜를 입력해 주세요.");
    }
    if (startDate && endDate && endDate < startDate) {
      addIssue(issues, rowNumber, "contract_end_date", "END_BEFORE_START", "종료일이 시작일보다 빠릅니다.");
    }
    if (status === "ACTIVE" && startDate && startDate > asOfDate) {
      addIssue(issues, rowNumber, "contract_status", "ACTIVE_NOT_STARTED", "시작 전 계약은 ACTIVE일 수 없습니다.");
    }
    if (status === "ACTIVE" && endDate && endDate < asOfDate) {
      addIssue(issues, rowNumber, "contract_status", "ACTIVE_CONTRACT_EXPIRED", "종료된 계약은 ACTIVE일 수 없습니다.");
    }

    const booleanValue = (field: ImportFieldName) => {
      const parsed = parseBoolean(value(field));
      if (parsed === null) addIssue(issues, rowNumber, field, "INVALID_BOOLEAN", "true 또는 false가 필요합니다.");
      return parsed ?? false;
    };
    const hostActive = booleanValue("host_active");
    const hostNotificationEnabled = booleanValue("host_notification_enabled");
    const guestActive = booleanValue("guest_active");
    const guestNotificationEnabled = booleanValue("guest_notification_enabled");
    const homeActive = booleanValue("home_active");

    const rawHostPhone = text(value("host_phone"), 80);
    const rawGuestPhone = text(value("guest_phone"), 80);
    const hostPhone = normalizeKoreanMobile(rawHostPhone);
    const guestPhone = normalizeKoreanMobile(rawGuestPhone);
    if (rawHostPhone && !hostPhone) {
      addIssue(issues, rowNumber, "host_phone", "INVALID_PHONE", "한국 휴대전화번호 형식이 아닙니다.");
    }
    if (rawGuestPhone && !guestPhone) {
      addIssue(issues, rowNumber, "guest_phone", "INVALID_PHONE", "한국 휴대전화번호 형식이 아닙니다.");
    }
    if (status === "ACTIVE" && hostActive && hostNotificationEnabled && !hostPhone) {
      addIssue(issues, rowNumber, "host_phone", "ACTIVE_PHONE_REQUIRED", "활성 알림 대상 집주인의 전화번호가 없습니다.");
    }
    if (status === "ACTIVE" && guestActive && guestNotificationEnabled && !guestPhone) {
      addIssue(issues, rowNumber, "guest_phone", "ACTIVE_PHONE_REQUIRED", "활성 알림 대상 학생의 전화번호가 없습니다.");
    }

    const sourceSystem = required("source_system", 80).toLowerCase();
    const contractExternalId = required("contract_external_id", 160);
    const homeExternalId = required("home_external_id", 160);
    const hostExternalId = required("host_external_id", 160);
    const guestExternalId = required("guest_external_id", 160);
    const homeName = required("home_name", 100);
    const hostName = required("host_name", 80);
    const guestName = required("guest_name", 80);

    if (hostExternalId && hostExternalId === guestExternalId) {
      addIssue(issues, rowNumber, "row", "HOST_GUEST_SAME", "집주인과 학생 외부 ID가 같습니다.");
    }

    if (
      sourceSystem && contractExternalId && homeExternalId && hostExternalId && guestExternalId &&
      homeName && hostName && guestName && status && startDate
    ) {
      rows.push({
        rowNumber,
        sourceSystem,
        contract: { externalId: contractExternalId, status, startDate, endDate },
        home: {
          externalId: homeExternalId,
          name: homeName,
          address: text(value("home_address"), 500) || null,
          city: text(value("home_city"), 100) || null,
          district: text(value("home_district"), 100) || null,
          active: homeActive,
        },
        host: {
          externalId: hostExternalId,
          name: hostName,
          phone: hostPhone,
          email: normalizeEmail(value("host_email")),
          active: hostActive,
          notificationEnabled: hostNotificationEnabled,
        },
        guest: {
          externalId: guestExternalId,
          name: guestName,
          phone: guestPhone,
          email: normalizeEmail(value("guest_email")),
          active: guestActive,
          notificationEnabled: guestNotificationEnabled,
        },
      });
    }
  });

  return { rows, issues };
}
