import "server-only";

import type { AdminRequiredPermission } from "@/lib/auth/admin";
import {
  dateMatchesFilter,
  serializeCsv,
  testFlagMatches,
  type CsvCell,
  type CsvDataset,
  type CsvExportFilters,
} from "@/lib/admin/csv";
import { createAdminClient } from "@/lib/supabase/admin";

type JsonRow = Record<string, unknown>;
type PageResult = { data: unknown; error: unknown };
type CsvPermissionRequirement = readonly [
  AdminRequiredPermission,
  ...AdminRequiredPermission[],
];

const PAGE_SIZE = 500;
const MAX_EXPORT_ROWS = 50_000;

const datasetPermissions: Record<CsvDataset, CsvPermissionRequirement> = {
  profiles: ["SUPER_ADMIN"],
  hosts: ["SUPER_ADMIN"],
  guests: ["SUPER_ADMIN"],
  homes: ["SUPER_ADMIN"],
  "active-matches": ["SUPER_ADMIN"],
  matches: ["SUPER_ADMIN"],
  "weekly-checkins": ["DATA_EXPORT"],
  "checkin-responses": ["DATA_EXPORT", "SAFETY_READ"],
  issues: ["DATA_EXPORT", "SAFETY_READ"],
  "notification-outbox": ["SUPER_ADMIN"],
};

const datasetNames: Record<CsvDataset, string> = {
  profiles: "profiles",
  hosts: "hosts",
  guests: "guests",
  homes: "homes",
  "active-matches": "active-matches",
  matches: "matches",
  "weekly-checkins": "weekly-checkins",
  "checkin-responses": "checkin-responses",
  issues: "issues",
  "notification-outbox": "notification-outbox",
};

export function requiredPermissionsForCsv(
  dataset: CsvDataset,
): CsvPermissionRequirement {
  return datasetPermissions[dataset];
}

function first(value: unknown): JsonRow | undefined {
  if (Array.isArray(value)) return value[0] as JsonRow | undefined;
  return value && typeof value === "object" ? (value as JsonRow) : undefined;
}

function json(value: unknown): string {
  return value == null ? "" : JSON.stringify(value);
}

function koreanPeriod(start: unknown, end: unknown): string {
  if (typeof start !== "string" || typeof end !== "string") return "";
  const format = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
  return `${format.format(new Date(`${start}T00:00:00+09:00`))} ~ ${format.format(
    new Date(`${end}T23:59:59+09:00`),
  )}`;
}

function currentKoreanDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function collectPages(
  fetchPage: (from: number, to: number) => Promise<PageResult>,
): Promise<JsonRow[]> {
  const collected: JsonRow[] = [];
  for (let offset = 0; offset < MAX_EXPORT_ROWS; offset += PAGE_SIZE) {
    const result = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = Array.isArray(result.data) ? (result.data as JsonRow[]) : [];
    collected.push(...page);
    if (page.length < PAGE_SIZE) return collected;
  }
  throw new Error("CSV_EXPORT_ROW_LIMIT_EXCEEDED");
}

function filteredByStatus(row: JsonRow, filters: CsvExportFilters): boolean {
  return !filters.status || String(row.status ?? "") === filters.status;
}

function filteredByMatch(row: JsonRow, filters: CsvExportFilters): boolean {
  return (
    !filters.match ||
    String(row.match_id ?? row.id ?? "").toLowerCase().includes(filters.match.toLowerCase())
  );
}

function headersAndRows(
  headers: string[],
  rows: CsvCell[][],
): { headers: string[]; rows: CsvCell[][] } {
  return { headers, rows };
}

async function exportProfiles(
  dataset: "profiles" | "hosts" | "guests",
  filters: CsvExportFilters,
) {
  const supabase = createAdminClient();
  const rows = await collectPages(async (from, to) => {
    let query = supabase
      .from("profiles")
      .select("id,auth_user_id,profile_type,display_name,phone,email,notification_enabled,source_system,source_record_id,is_active,created_at,updated_at")
      .order("created_at", { ascending: true });
    if (dataset === "hosts") query = query.eq("profile_type", "HOST");
    if (dataset === "guests") query = query.eq("profile_type", "GUEST");
    return query.range(from, to);
  });
  const filtered = rows
    .filter((row) => dateMatchesFilter(row.created_at, filters))
    .filter((row) => {
      if (!filters.status) return true;
      return filters.status === "ACTIVE" ? row.is_active === true : row.is_active !== true;
    });
  return headersAndRows(
    ["ID", "Auth 사용자 ID", "역할", "이름", "전화번호", "이메일", "알림 허용", "원천 시스템", "원천 레코드 ID", "활성", "생성일", "수정일"],
    filtered.map((row) => [
      String(row.id ?? ""),
      String(row.auth_user_id ?? ""),
      String(row.profile_type ?? ""),
      String(row.display_name ?? ""),
      String(row.phone ?? ""),
      String(row.email ?? ""),
      row.notification_enabled === true,
      String(row.source_system ?? ""),
      String(row.source_record_id ?? ""),
      row.is_active === true,
      String(row.created_at ?? ""),
      String(row.updated_at ?? ""),
    ]),
  );
}

async function exportHomes(filters: CsvExportFilters) {
  const supabase = createAdminClient();
  const rows = await collectPages(async (from, to) =>
    supabase
      .from("homes")
      .select("id,name,address,city,district,host_profile_id,source_system,source_record_id,is_active,created_at,updated_at")
      .order("created_at", { ascending: true })
      .range(from, to),
  );
  const filtered = rows
    .filter((row) => dateMatchesFilter(row.created_at, filters))
    .filter((row) => {
      if (!filters.status) return true;
      return filters.status === "ACTIVE" ? row.is_active === true : row.is_active !== true;
    });
  return headersAndRows(
    ["ID", "주거지명", "주소", "도시", "구/군", "Host Profile ID", "원천 시스템", "원천 레코드 ID", "활성", "생성일", "수정일"],
    filtered.map((row) => [
      String(row.id ?? ""),
      String(row.name ?? ""),
      String(row.address ?? ""),
      String(row.city ?? ""),
      String(row.district ?? ""),
      String(row.host_profile_id ?? ""),
      String(row.source_system ?? ""),
      String(row.source_record_id ?? ""),
      row.is_active === true,
      String(row.created_at ?? ""),
      String(row.updated_at ?? ""),
    ]),
  );
}

async function exportMatches(dataset: "matches" | "active-matches", filters: CsvExportFilters) {
  const supabase = createAdminClient();
  const rows = await collectPages(async (from, to) => {
    let query = supabase
      .from("matches")
      .select(
        "id,home_id,host_id,guest_id,status,move_in_date,move_out_date,contract_end_date,source_system,source_record_id,created_at,updated_at",
      )
      .order("created_at", { ascending: true });
    if (dataset === "active-matches") query = query.eq("status", "ACTIVE");
    return query.range(from, to);
  });
  const filtered = rows
    .filter((row) => dateMatchesFilter(row.created_at, filters))
    .filter((row) => filteredByStatus(row, filters))
    .filter((row) => filteredByMatch(row, filters));
  return headersAndRows(
    ["ID", "Home ID", "Host ID", "Guest ID", "상태", "입주일", "퇴거일", "계약 종료일", "원천 시스템", "원천 레코드 ID", "생성일", "수정일"],
    filtered.map((row) => [
      String(row.id ?? ""),
      String(row.home_id ?? ""),
      String(row.host_id ?? ""),
      String(row.guest_id ?? ""),
      String(row.status ?? ""),
      String(row.move_in_date ?? ""),
      String(row.move_out_date ?? ""),
      String(row.contract_end_date ?? ""),
      String(row.source_system ?? ""),
      String(row.source_record_id ?? ""),
      String(row.created_at ?? ""),
      String(row.updated_at ?? ""),
    ]),
  );
}

async function exportWeeklyCheckins(filters: CsvExportFilters) {
  const supabase = createAdminClient();
  const rows = await collectPages(async (from, to) =>
    supabase
      .from("weekly_checkin_invitations")
      .select(
        "id,run_id,match_id,participant_id,role,status,sent_at,reminder_sent_at,opened_at,completed_at,expires_at,created_at,is_test,participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name),run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end)",
      )
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const filtered = rows
    .filter((row) => testFlagMatches(row.is_test, filters.includeTest))
    .filter((row) => dateMatchesFilter(row.created_at, filters))
    .filter((row) => !filters.role || row.role === filters.role)
    .filter((row) => filteredByStatus(row, filters))
    .filter((row) => filteredByMatch(row, filters))
    .filter((row) => {
      const run = first(row.run);
      return !filters.week || koreanPeriod(run?.week_start, run?.week_end) === filters.week;
    });
  return headersAndRows(
    ["초대 ID", "Run ID", "Match ID", "참여자 ID", "이름", "역할", "주차", "상태", "발송일", "리마인드일", "열람일", "완료일", "만료일", "테스트"],
    filtered.map((row) => {
      const participant = first(row.participant);
      const run = first(row.run);
      return [
        String(row.id ?? ""),
        String(row.run_id ?? ""),
        String(row.match_id ?? ""),
        String(row.participant_id ?? ""),
        String(participant?.display_name ?? ""),
        String(row.role ?? ""),
        koreanPeriod(run?.week_start, run?.week_end),
        String(row.status ?? ""),
        String(row.sent_at ?? ""),
        String(row.reminder_sent_at ?? ""),
        String(row.opened_at ?? ""),
        String(row.completed_at ?? ""),
        String(row.expires_at ?? ""),
        row.is_test === true,
      ];
    }),
  );
}

function responseMatches(row: JsonRow, filters: CsvExportFilters): boolean {
  const invitation = first(row.invitation);
  const run = first(invitation?.run);
  const supportCase = first(row.support_case);
  const issues = Array.isArray(row.issues) ? (row.issues as JsonRow[]) : [];
  return (
    testFlagMatches(row.is_test ?? invitation?.is_test, filters.includeTest) &&
    dateMatchesFilter(row.submitted_at, filters) &&
    (!filters.week || koreanPeriod(run?.week_start, run?.week_end) === filters.week) &&
    (!filters.role || row.role === filters.role) &&
    (!filters.risk || row.risk_level === filters.risk) &&
    filteredByMatch(row, filters) &&
    (!filters.responseState ||
      filters.responseState === "COMPLETED" ||
      (filters.responseState === "HAS_CASE" && Boolean(supportCase)) ||
      (filters.responseState === "NO_CASE" && !supportCase) ||
      (filters.responseState === "PAIRED_MISMATCH" && row.paired_mismatch === true)) &&
    (!filters.category || issues.some((issue) => issue.category === filters.category)) &&
    (!filters.desiredAction ||
      issues.some((issue) => issue.desired_action === filters.desiredAction)) &&
    (!filters.caseStatus || supportCase?.status === filters.caseStatus) &&
    (!filters.assignee ||
      String(supportCase?.assigned_admin_id ?? "")
        .toLowerCase()
        .includes(filters.assignee.toLowerCase()))
  );
}

async function loadResponses() {
  const supabase = createAdminClient();
  return collectPages(async (from, to) =>
    supabase
      .from("weekly_checkin_responses")
      .select(
        "*,invitation:weekly_checkin_invitations!weekly_checkin_responses_invitation_id_fkey(is_test,participant:profiles!weekly_checkin_invitations_participant_id_fkey(display_name),run:weekly_checkin_runs!weekly_checkin_invitations_run_id_fkey(week_start,week_end)),issues:weekly_checkin_issues(*),support_case:support_cases(*)",
      )
      .order("submitted_at", { ascending: false })
      .range(from, to),
  );
}

async function exportResponses(filters: CsvExportFilters) {
  const rows = (await loadResponses()).filter((row) => responseMatches(row, filters));
  return headersAndRows(
    ["응답 ID", "초대 ID", "Match ID", "참여자 ID", "이름", "역할", "주차", "전체 상태", "위험도", "위험 사유", "응답 차이", "지원 요청", "답변 JSON", "제출일", "테스트"],
    rows.map((row) => {
      const invitation = first(row.invitation);
      const participant = first(invitation?.participant);
      const run = first(invitation?.run);
      return [
        String(row.id ?? ""),
        String(row.invitation_id ?? ""),
        String(row.match_id ?? ""),
        String(row.participant_id ?? ""),
        String(participant?.display_name ?? ""),
        String(row.role ?? ""),
        koreanPeriod(run?.week_start, run?.week_end),
        String(row.overall_status ?? ""),
        String(row.risk_level ?? ""),
        json(row.risk_reasons),
        row.paired_mismatch === true,
        json(row.desired_support),
        json(row.answers_json),
        String(row.submitted_at ?? ""),
        row.is_test === true,
      ];
    }),
  );
}

async function exportIssues(filters: CsvExportFilters) {
  const responses = (await loadResponses()).filter((row) => responseMatches(row, filters));
  const rows = responses.flatMap((response) => {
    const issues = Array.isArray(response.issues) ? (response.issues as JsonRow[]) : [];
    return issues.map((issue) => ({ response, issue }));
  });
  return headersAndRows(
    ["Issue ID", "응답 ID", "Match ID", "참여자 ID", "역할", "위험도", "카테고리", "세부 유형", "빈도", "심각도", "대화 상태", "희망 조치", "추가 메모", "생성일", "테스트"],
    rows.map(({ response, issue }) => [
      String(issue.id ?? ""),
      String(response.id ?? ""),
      String(response.match_id ?? ""),
      String(response.participant_id ?? ""),
      String(response.role ?? ""),
      String(response.risk_level ?? ""),
      String(issue.category ?? ""),
      String(issue.subcategory ?? ""),
      String(issue.frequency ?? ""),
      Number(issue.severity ?? 0),
      String(issue.discussion_status ?? ""),
      String(issue.desired_action ?? ""),
      String(issue.additional_note ?? ""),
      String(issue.created_at ?? ""),
      response.is_test === true,
    ]),
  );
}

async function exportNotificationOutbox(filters: CsvExportFilters) {
  const supabase = createAdminClient();
  const rows = await collectPages(async (from, to) =>
    supabase
      .from("message_logs")
      .select(
        "id,invitation_id,provider,message_type,delivery_scope,template_code,recipient_masked,idempotency_key,provider_message_id,status,attempt_count,max_attempts,next_attempt_at,failure_class,error_code,sent_at,created_at,updated_at,is_test",
      )
      .order("created_at", { ascending: false })
      .range(from, to),
  );
  const filtered = rows
    .filter((row) => testFlagMatches(row.is_test, filters.includeTest))
    .filter((row) => dateMatchesFilter(row.created_at, filters))
    .filter((row) => filteredByStatus(row, filters));
  return headersAndRows(
    ["Message ID", "초대 ID", "Provider", "유형", "범위", "Template", "수신자 마스킹", "Idempotency Key", "Provider Message ID", "상태", "시도", "최대 시도", "다음 재시도", "실패 분류", "오류 코드", "발송일", "생성일", "수정일", "테스트"],
    filtered.map((row) => [
      String(row.id ?? ""),
      String(row.invitation_id ?? ""),
      String(row.provider ?? ""),
      String(row.message_type ?? ""),
      String(row.delivery_scope ?? ""),
      String(row.template_code ?? ""),
      String(row.recipient_masked ?? ""),
      String(row.idempotency_key ?? ""),
      String(row.provider_message_id ?? ""),
      String(row.status ?? ""),
      Number(row.attempt_count ?? 0),
      Number(row.max_attempts ?? 0),
      String(row.next_attempt_at ?? ""),
      String(row.failure_class ?? ""),
      String(row.error_code ?? ""),
      String(row.sent_at ?? ""),
      String(row.created_at ?? ""),
      String(row.updated_at ?? ""),
      row.is_test === true,
    ]),
  );
}

export async function recordCsvExportAudit(
  adminId: string,
  dataset: CsvDataset,
  filters: CsvExportFilters,
  rowCount: number,
): Promise<void> {
  const appliedFilters = Object.entries(filters)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .sort();
  const { error } = await createAdminClient().from("audit_logs").insert({
    admin_id: adminId,
    entity_type: "CSV_EXPORT",
    entity_id: adminId,
    action: `EXPORT_${dataset.toUpperCase().replace(/-/g, "_")}`,
    before_json: null,
    after_json: {
      dataset,
      rowCount,
      appliedFilters,
      from: filters.from ?? null,
      to: filters.to ?? null,
    },
  });
  if (error) throw error;
}

export async function createCsvExport(
  dataset: CsvDataset,
  filters: CsvExportFilters,
): Promise<{ body: string; filename: string; rowCount: number }> {
  const result =
    dataset === "profiles" || dataset === "hosts" || dataset === "guests"
      ? await exportProfiles(dataset, filters)
      : dataset === "homes"
        ? await exportHomes(filters)
        : dataset === "matches" || dataset === "active-matches"
          ? await exportMatches(dataset, filters)
          : dataset === "weekly-checkins"
            ? await exportWeeklyCheckins(filters)
            : dataset === "checkin-responses"
              ? await exportResponses(filters)
              : dataset === "issues"
                ? await exportIssues(filters)
                : await exportNotificationOutbox(filters);
  return {
    body: serializeCsv(result.headers, result.rows),
    filename: `hometogether-${datasetNames[dataset]}-${currentKoreanDate()}.csv`,
    rowCount: result.rows.length,
  };
}
