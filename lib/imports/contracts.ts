export const importFieldNames = [
  "source_system",
  "contract_external_id",
  "contract_status",
  "contract_start_date",
  "contract_end_date",
  "home_external_id",
  "home_name",
  "home_address",
  "home_city",
  "home_district",
  "home_active",
  "host_external_id",
  "host_name",
  "host_phone",
  "host_email",
  "host_active",
  "host_notification_enabled",
  "guest_external_id",
  "guest_name",
  "guest_phone",
  "guest_email",
  "guest_active",
  "guest_notification_enabled",
] as const;

export type ImportFieldName = (typeof importFieldNames)[number];
export type ImportColumnMapping = Record<ImportFieldName, string>;

export const requiredImportFields = [
  "source_system",
  "contract_external_id",
  "contract_status",
  "contract_start_date",
  "home_external_id",
  "home_name",
  "home_active",
  "host_external_id",
  "host_name",
  "host_active",
  "host_notification_enabled",
  "guest_external_id",
  "guest_name",
  "guest_active",
  "guest_notification_enabled",
] as const satisfies readonly ImportFieldName[];

export const importFieldLabels: Record<ImportFieldName, string> = {
  source_system: "원본 시스템",
  contract_external_id: "계약 외부 ID",
  contract_status: "계약 상태",
  contract_start_date: "계약 시작일",
  contract_end_date: "계약 종료일",
  home_external_id: "주거지 외부 ID",
  home_name: "주거지 이름",
  home_address: "주소",
  home_city: "시/도",
  home_district: "시/군/구",
  home_active: "주거지 활성 여부",
  host_external_id: "집주인 외부 ID",
  host_name: "집주인 이름",
  host_phone: "집주인 휴대전화",
  host_email: "집주인 이메일",
  host_active: "집주인 활성 여부",
  host_notification_enabled: "집주인 알림 동의",
  guest_external_id: "학생 외부 ID",
  guest_name: "학생 이름",
  guest_phone: "학생 휴대전화",
  guest_email: "학생 이메일",
  guest_active: "학생 활성 여부",
  guest_notification_enabled: "학생 알림 동의",
};
export function createDefaultColumnMapping(
  headers: readonly string[],
): ImportColumnMapping {
  const normalized = new Map(headers.map((header) => [header.trim().toLowerCase(), header]));
  return Object.fromEntries(
    importFieldNames.map((field) => [field, normalized.get(field) ?? ""]),
  ) as ImportColumnMapping;
}

export type ImportContractStatus =
  | "PENDING"
  | "ACTIVE"
  | "MOVE_OUT_SCHEDULED"
  | "ENDED"
  | "CANCELLED";

export type ImportParticipant = {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  notificationEnabled: boolean;
};

export type NormalizedImportRow = {
  rowNumber: number;
  sourceSystem: string;
  contract: {
    externalId: string;
    status: ImportContractStatus;
    startDate: string;
    endDate: string | null;
  };
  home: {
    externalId: string;
    name: string;
    address: string | null;
    city: string | null;
    district: string | null;
    active: boolean;
  };
  host: ImportParticipant;
  guest: ImportParticipant;
};

export type ImportIssueSeverity = "ERROR" | "WARNING";

export type ImportIssue = {
  rowNumber: number;
  field: ImportFieldName | "row";
  code: string;
  severity: ImportIssueSeverity;
  message: string;
};

export type ExistingImportProfile = {
  id: string;
  profileType: "HOST" | "GUEST" | "ADMIN" | "STAFF";
  displayName: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  notificationEnabled: boolean;
  sourceSystem: string | null;
  sourceRecordId: string | null;
};

export type ExistingImportHome = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  active: boolean;
  hostProfileId: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
};

export type ExistingImportMatch = {
  id: string;
  homeId: string;
  hostId: string;
  guestId: string;
  status: ImportContractStatus;
  startDate: string;
  moveOutDate: string | null;
  endDate: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
};

export type ExistingImportSnapshot = {
  profiles: ExistingImportProfile[];
  homes: ExistingImportHome[];
  matches: ExistingImportMatch[];
  invitationParticipantIds: string[];
};

export type ImportPlanCounts = {
  sourceRows: number;
  existingHosts: number;
  existingGuests: number;
  existingHomes: number;
  existingActiveMatches: number;
  createProfiles: number;
  updateProfiles: number;
  unchangedProfiles: number;
  createHomes: number;
  updateHomes: number;
  unchangedHomes: number;
  createMatches: number;
  updateMatches: number;
  unchangedMatches: number;
  duplicateSuspects: number;
  missingRequired: number;
  activeUsersWithoutPhone: number;
  invalidPhone: number;
  expectedWeeklyTargets: number;
};

export type ImportPreviewRow = {
  rowNumber: number;
  contractExternalId: string;
  contractStatus: ImportContractStatus;
  homeName: string;
  hostName: string;
  hostPhoneMasked: string | null;
  guestName: string;
  guestPhoneMasked: string | null;
  issueCodes: string[];
};

export type OperationalImportPlan = {
  fileSha256: string;
  planSha256: string;
  normalizedRows: NormalizedImportRow[];
  previewRows: ImportPreviewRow[];
  issues: ImportIssue[];
  counts: ImportPlanCounts;
  canApply: boolean;
};
