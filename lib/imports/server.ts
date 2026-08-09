import "server-only";

import type {
  ExistingImportSnapshot,
  ImportColumnMapping,
  OperationalImportPlan,
} from "@/lib/imports/contracts";
import {
  applyOperationalDataImportWithClient,
  currentKoreanDate,
  loadExistingImportSnapshotWithClient,
  previewOperationalDataImportWithClient,
  type OperationalImportApplyResult,
} from "@/lib/imports/service-role-operations";
import { createAdminClient } from "@/lib/supabase/admin";

export { currentKoreanDate };

export async function loadExistingImportSnapshot(
  asOfDate: string,
): Promise<ExistingImportSnapshot> {
  return loadExistingImportSnapshotWithClient(createAdminClient(), asOfDate);
}

export async function previewOperationalDataImport(input: {
  csv: string;
  mapping: ImportColumnMapping;
  asOfDate?: string;
}): Promise<OperationalImportPlan> {
  return previewOperationalDataImportWithClient(createAdminClient(), input);
}

export type { OperationalImportApplyResult };

export async function applyOperationalDataImport(input: {
  adminId: string;
  fileName: string;
  plan: OperationalImportPlan;
}): Promise<OperationalImportApplyResult> {
  return applyOperationalDataImportWithClient(createAdminClient(), input);
}
