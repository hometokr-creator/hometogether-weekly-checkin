import { basename } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ExistingImportHome,
  ExistingImportMatch,
  ExistingImportProfile,
  ExistingImportSnapshot,
  ImportColumnMapping,
  OperationalImportPlan,
} from "@/lib/imports/contracts";
import { createOperationalImportPlan } from "@/lib/imports/plan";
import { fetchAllSupabaseRows } from "@/lib/supabase/pagination";

// This module deliberately accepts an already-created client instead of
// reading credentials itself. Next.js routes reach it through the server-only
// wrapper, while the operational CLI can use the same reviewed data contract.

function mondayFor(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

export function currentKoreanDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export async function loadExistingImportSnapshotWithClient(
  supabase: SupabaseClient,
  asOfDate: string,
): Promise<ExistingImportSnapshot> {
  const weekStart = mondayFor(asOfDate);
  const [profileRows, homeRows, matchRows, runResult] = await Promise.all([
    fetchAllSupabaseRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("profiles")
        .select(
          "id,profile_type,display_name,phone,email,is_active,notification_enabled,source_system,source_record_id",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllSupabaseRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("homes")
        .select(
          "id,name,address,city,district,is_active,host_profile_id,source_system,source_record_id",
        )
        .order("id")
        .range(from, to),
    ),
    fetchAllSupabaseRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("matches")
        .select(
          "id,home_id,host_id,guest_id,status,move_in_date,move_out_date,contract_end_date,source_system,source_record_id",
        )
        .order("id")
        .range(from, to),
    ),
    supabase.from("weekly_checkin_runs").select("id").eq("week_start", weekStart).maybeSingle(),
  ]);

  if (runResult.error) throw runResult.error;

  let invitationParticipantIds: string[] = [];
  if (runResult.data?.id) {
    const runId = runResult.data.id;
    const invitationRows = await fetchAllSupabaseRows<Record<string, unknown>>((from, to) =>
      supabase
        .from("weekly_checkin_invitations")
        .select("participant_id")
        .eq("run_id", runId)
        .order("participant_id")
        .range(from, to),
    );
    invitationParticipantIds = invitationRows.map((row) => asString(row.participant_id));
  }

  const profiles: ExistingImportProfile[] = profileRows.map((row) => ({
    id: asString(row.id),
    profileType: row.profile_type as ExistingImportProfile["profileType"],
    displayName: asString(row.display_name),
    phone: asNullableString(row.phone),
    email: asNullableString(row.email),
    active: row.is_active === true,
    notificationEnabled: row.notification_enabled === true,
    sourceSystem: asNullableString(row.source_system),
    sourceRecordId: asNullableString(row.source_record_id),
  }));
  const homes: ExistingImportHome[] = homeRows.map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    address: asNullableString(row.address),
    city: asNullableString(row.city),
    district: asNullableString(row.district),
    active: row.is_active === true,
    hostProfileId: asNullableString(row.host_profile_id),
    sourceSystem: asNullableString(row.source_system),
    sourceRecordId: asNullableString(row.source_record_id),
  }));
  const matches: ExistingImportMatch[] = matchRows.map((row) => ({
    id: asString(row.id),
    homeId: asString(row.home_id),
    hostId: asString(row.host_id),
    guestId: asString(row.guest_id),
    status: row.status as ExistingImportMatch["status"],
    startDate: asString(row.move_in_date),
    moveOutDate: asNullableString(row.move_out_date),
    endDate: asNullableString(row.contract_end_date),
    sourceSystem: asNullableString(row.source_system),
    sourceRecordId: asNullableString(row.source_record_id),
  }));

  return { profiles, homes, matches, invitationParticipantIds };
}

export async function previewOperationalDataImportWithClient(
  supabase: SupabaseClient,
  input: {
    csv: string;
    mapping: ImportColumnMapping;
    asOfDate?: string;
  },
): Promise<OperationalImportPlan> {
  const asOfDate = input.asOfDate ?? currentKoreanDate();
  const existing = await loadExistingImportSnapshotWithClient(supabase, asOfDate);
  return createOperationalImportPlan({ ...input, asOfDate, existing });
}

export type OperationalImportApplyResult = {
  batchId: string;
  alreadyApplied: boolean;
  counts: OperationalImportPlan["counts"];
};

export async function applyOperationalDataImportWithClient(
  supabase: SupabaseClient,
  input: {
    adminId: string;
    fileName: string;
    plan: OperationalImportPlan;
  },
): Promise<OperationalImportApplyResult> {
  if (!input.plan.canApply) throw new Error("OPERATIONAL_IMPORT_HAS_ERRORS");
  const safeFileName = basename(input.fileName).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
  if (!safeFileName) throw new Error("OPERATIONAL_IMPORT_FILE_NAME_INVALID");

  const { data, error } = await supabase.rpc("apply_operational_data_import", {
    p_admin_id: input.adminId,
    p_file_name: safeFileName,
    p_file_sha256: input.plan.fileSha256,
    p_plan_sha256: input.plan.planSha256,
    p_counts: input.plan.counts,
    p_rows: input.plan.normalizedRows,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("OPERATIONAL_IMPORT_RESULT_INVALID");
  }
  const result = data as Record<string, unknown>;
  if (typeof result.batchId !== "string") throw new Error("OPERATIONAL_IMPORT_RESULT_INVALID");
  return {
    batchId: result.batchId,
    alreadyApplied: result.alreadyApplied === true,
    counts: input.plan.counts,
  };
}
