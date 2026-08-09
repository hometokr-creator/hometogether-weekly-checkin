import { createHash } from "node:crypto";

import {
  evaluateWeeklyEligibility,
  type EligibilityMatch,
} from "@/lib/checkin/eligibility";
import {
  type ExistingImportHome,
  type ExistingImportMatch,
  type ExistingImportProfile,
  type ExistingImportSnapshot,
  type ImportColumnMapping,
  type ImportIssue,
  type ImportParticipant,
  type NormalizedImportRow,
  type OperationalImportPlan,
} from "@/lib/imports/contracts";
import { parseCsv } from "@/lib/imports/csv";
import {
  maskKoreanMobile,
  normalizeImportRows,
  validateColumnMapping,
} from "@/lib/imports/normalize";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sourceKey(sourceSystem: string, externalId: string): string {
  return `${sourceSystem}\u0000${externalId}`;
}

function profileSourceKey(row: NormalizedImportRow, role: "HOST" | "GUEST"): string {
  const participant = role === "HOST" ? row.host : row.guest;
  return sourceKey(row.sourceSystem, participant.externalId);
}

function sameNullable(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

function sameProfile(
  existing: ExistingImportProfile,
  desired: ImportParticipant,
  role: "HOST" | "GUEST",
): boolean {
  return (
    existing.profileType === role &&
    existing.displayName === desired.name &&
    sameNullable(existing.phone, desired.phone) &&
    sameNullable(existing.email, desired.email) &&
    existing.active === desired.active &&
    existing.notificationEnabled === desired.notificationEnabled
  );
}

function sameHome(
  existing: ExistingImportHome,
  desired: NormalizedImportRow["home"],
  desiredHostId: string | null,
): boolean {
  return (
    existing.name === desired.name &&
    sameNullable(existing.address, desired.address) &&
    sameNullable(existing.city, desired.city) &&
    sameNullable(existing.district, desired.district) &&
    existing.active === desired.active &&
    desiredHostId !== null &&
    existing.hostProfileId === desiredHostId
  );
}

function sameMatch(
  existing: ExistingImportMatch,
  desired: NormalizedImportRow,
  expectedIds: { homeId: string | null; hostId: string | null; guestId: string | null },
): boolean {
  return (
    expectedIds.homeId !== null &&
    expectedIds.hostId !== null &&
    expectedIds.guestId !== null &&
    existing.homeId === expectedIds.homeId &&
    existing.hostId === expectedIds.hostId &&
    existing.guestId === expectedIds.guestId &&
    existing.status === desired.contract.status &&
    existing.startDate === desired.contract.startDate &&
    sameNullable(existing.endDate, desired.contract.endDate) &&
    existing.moveOutDate === null
  );
}

function addDuplicateIssue(
  issues: ImportIssue[],
  rows: readonly NormalizedImportRow[],
  code: string,
  message: string,
) {
  for (const row of rows) {
    issues.push({ rowNumber: row.rowNumber, field: "row", code, severity: "ERROR", message });
  }
}

function validateDuplicates(rows: readonly NormalizedImportRow[], issues: ImportIssue[]) {
  const contracts = new Map<string, NormalizedImportRow[]>();
  const profilePayloads = new Map<string, Array<{ row: NormalizedImportRow; payload: string }>>();
  const phoneSources = new Map<string, Map<string, NormalizedImportRow[]>>();
  const emailSources = new Map<string, Map<string, NormalizedImportRow[]>>();
  const activeContracts = new Map<string, Map<string, NormalizedImportRow[]>>();

  const addSourceCandidate = (
    collection: Map<string, Map<string, NormalizedImportRow[]>>,
    value: string | null,
    role: "HOST" | "GUEST",
    row: NormalizedImportRow,
    externalId: string,
  ) => {
    if (!value) return;
    const identity = `${role}:${value}`;
    const bySource = collection.get(identity) ?? new Map<string, NormalizedImportRow[]>();
    const key = sourceKey(row.sourceSystem, externalId);
    bySource.set(key, [...(bySource.get(key) ?? []), row]);
    collection.set(identity, bySource);
  };

  for (const row of rows) {
    const contractKey = sourceKey(row.sourceSystem, row.contract.externalId);
    contracts.set(contractKey, [...(contracts.get(contractKey) ?? []), row]);
    for (const role of ["HOST", "GUEST"] as const) {
      const participant = role === "HOST" ? row.host : row.guest;
      const key = sourceKey(row.sourceSystem, participant.externalId);
      profilePayloads.set(key, [
        ...(profilePayloads.get(key) ?? []),
        { row, payload: stableJson({ ...participant, role }) },
      ]);
      addSourceCandidate(phoneSources, participant.phone, role, row, participant.externalId);
      addSourceCandidate(emailSources, participant.email, role, row, participant.externalId);
      if (row.contract.status === "ACTIVE") {
        const contractsForProfile = activeContracts.get(key) ?? new Map<string, NormalizedImportRow[]>();
        contractsForProfile.set(contractKey, [
          ...(contractsForProfile.get(contractKey) ?? []),
          row,
        ]);
        activeContracts.set(key, contractsForProfile);
      }
    }
  }

  for (const duplicateRows of contracts.values()) {
    if (duplicateRows.length > 1) {
      addDuplicateIssue(issues, duplicateRows, "DUPLICATE_CONTRACT_SOURCE", "같은 계약 외부 ID가 두 행 이상 있습니다.");
    }
  }
  for (const entries of profilePayloads.values()) {
    if (new Set(entries.map((entry) => entry.payload)).size > 1) {
      addDuplicateIssue(
        issues,
        entries.map((entry) => entry.row),
        "PROFILE_SOURCE_CONFLICT",
        "같은 이용자 외부 ID의 정보가 행마다 다릅니다.",
      );
    }
  }
  for (const collection of [phoneSources, emailSources]) {
    for (const bySource of collection.values()) {
      if (bySource.size > 1) {
        addDuplicateIssue(
          issues,
          [...bySource.values()].flat(),
          "DUPLICATE_PROFILE_IDENTITY",
          "서로 다른 이용자 외부 ID가 같은 전화번호 또는 이메일을 사용합니다.",
        );
      }
    }
  }
  for (const byContract of activeContracts.values()) {
    if (byContract.size > 1) {
      addDuplicateIssue(
        issues,
        [...byContract.values()].flat(),
        "MULTIPLE_ACTIVE_MATCHES",
        "한 이용자가 동시에 여러 활성 계약에 포함되어 발송 대상을 결정할 수 없습니다.",
      );
    }
  }
}

function existingProfileIdentityConflict(
  existing: readonly ExistingImportProfile[],
  desired: ImportParticipant,
  role: "HOST" | "GUEST",
  exactSourceId: string | undefined,
): boolean {
  return existing.some(
    (profile) =>
      profile.id !== exactSourceId &&
      profile.profileType === role &&
      ((desired.phone && profile.phone === desired.phone) ||
        (desired.email && profile.email === desired.email)),
  );
}

function buildImportedEligibility(
  rows: readonly NormalizedImportRow[],
  existing: ExistingImportSnapshot,
): EligibilityMatch[] {
  const existingProfiles = new Map(
    existing.profiles
      .filter((profile) => profile.sourceSystem && profile.sourceRecordId)
      .map((profile) => [sourceKey(profile.sourceSystem!, profile.sourceRecordId!), profile]),
  );
  return rows.map((row) => ({
    id: existing.matches.find(
      (match) =>
        match.sourceSystem === row.sourceSystem &&
        match.sourceRecordId === row.contract.externalId,
    )?.id ?? sourceKey(row.sourceSystem, row.contract.externalId),
    status: row.contract.status,
    moveInDate: row.contract.startDate,
    moveOutDate: null,
    contractEndDate: row.contract.endDate,
    homeActive: row.home.active,
    host: {
      id: existingProfiles.get(profileSourceKey(row, "HOST"))?.id ?? profileSourceKey(row, "HOST"),
      active: row.host.active,
      notificationEnabled: row.host.notificationEnabled,
      phone: row.host.phone,
    },
    guest: {
      id: existingProfiles.get(profileSourceKey(row, "GUEST"))?.id ?? profileSourceKey(row, "GUEST"),
      active: row.guest.active,
      notificationEnabled: row.guest.notificationEnabled,
      phone: row.guest.phone,
    },
  }));
}

function buildUntouchedExistingEligibility(
  importedRows: readonly NormalizedImportRow[],
  existing: ExistingImportSnapshot,
): EligibilityMatch[] {
  const importedMatchKeys = new Set(
    importedRows.map((row) => sourceKey(row.sourceSystem, row.contract.externalId)),
  );
  const profiles = new Map(existing.profiles.map((profile) => [profile.id, profile]));
  const homes = new Map(existing.homes.map((home) => [home.id, home]));
  const result: EligibilityMatch[] = [];
  for (const match of existing.matches) {
    if (
      match.sourceSystem &&
      match.sourceRecordId &&
      importedMatchKeys.has(sourceKey(match.sourceSystem, match.sourceRecordId))
    ) continue;
    const host = profiles.get(match.hostId);
    const guest = profiles.get(match.guestId);
    const home = homes.get(match.homeId);
    if (!host || !guest || !home) continue;
    result.push({
      id: match.id,
      status: match.status,
      moveInDate: match.startDate,
      moveOutDate: match.moveOutDate,
      contractEndDate: match.endDate,
      homeActive: home.active,
      host: {
        id: host.id,
        active: host.active,
        notificationEnabled: host.notificationEnabled,
        phone: host.phone,
      },
      guest: {
        id: guest.id,
        active: guest.active,
        notificationEnabled: guest.notificationEnabled,
        phone: guest.phone,
      },
    });
  }
  return result;
}

export function createOperationalImportPlan(input: {
  csv: string;
  mapping: ImportColumnMapping;
  existing: ExistingImportSnapshot;
  asOfDate: string;
}): OperationalImportPlan {
  const parsed = parseCsv(input.csv);
  const mappingIssues = validateColumnMapping(parsed.headers, input.mapping);
  const normalized = normalizeImportRows(parsed.rows, input.mapping, input.asOfDate);
  const issues = [...mappingIssues, ...normalized.issues];
  if (parsed.rows.length === 0) {
    issues.push({
      rowNumber: 1,
      field: "row",
      code: "EMPTY_DATA",
      severity: "ERROR",
      message: "헤더 아래에 계약 데이터가 한 행 이상 필요합니다.",
    });
  }
  validateDuplicates(normalized.rows, issues);

  const existingProfilesBySource = new Map(
    input.existing.profiles
      .filter((profile) => profile.sourceSystem && profile.sourceRecordId)
      .map((profile) => [sourceKey(profile.sourceSystem!, profile.sourceRecordId!), profile]),
  );
  const existingHomesBySource = new Map(
    input.existing.homes
      .filter((home) => home.sourceSystem && home.sourceRecordId)
      .map((home) => [sourceKey(home.sourceSystem!, home.sourceRecordId!), home]),
  );
  const existingMatchesBySource = new Map(
    input.existing.matches
      .filter((match) => match.sourceSystem && match.sourceRecordId)
      .map((match) => [sourceKey(match.sourceSystem!, match.sourceRecordId!), match]),
  );

  const desiredProfiles = new Map<
    string,
    { participant: ImportParticipant; role: "HOST" | "GUEST"; row: NormalizedImportRow }
  >();
  const desiredHomes = new Map<string, NormalizedImportRow>();
  const desiredMatches = new Map<string, NormalizedImportRow>();
  for (const row of normalized.rows) {
    desiredProfiles.set(profileSourceKey(row, "HOST"), { participant: row.host, role: "HOST", row });
    desiredProfiles.set(profileSourceKey(row, "GUEST"), { participant: row.guest, role: "GUEST", row });
    desiredHomes.set(sourceKey(row.sourceSystem, row.home.externalId), row);
    desiredMatches.set(sourceKey(row.sourceSystem, row.contract.externalId), row);
  }

  let createProfiles = 0;
  let updateProfiles = 0;
  let unchangedProfiles = 0;
  for (const [key, desired] of desiredProfiles) {
    const existing = existingProfilesBySource.get(key);
    if (!existing) {
      if (
        existingProfileIdentityConflict(
          input.existing.profiles,
          desired.participant,
          desired.role,
          undefined,
        )
      ) {
        issues.push({
          rowNumber: desired.row.rowNumber,
          field: "row",
          code: "EXISTING_PROFILE_IDENTITY_CONFLICT",
          severity: "ERROR",
          message: "기존 이용자와 전화번호 또는 이메일이 같지만 외부 ID가 연결되지 않았습니다.",
        });
      }
      createProfiles += 1;
    } else if (existing.profileType !== desired.role) {
      issues.push({
        rowNumber: desired.row.rowNumber,
        field: "row",
        code: "PROFILE_ROLE_CONFLICT",
        severity: "ERROR",
        message: "기존 외부 ID의 이용자 역할이 CSV와 다릅니다.",
      });
      updateProfiles += 1;
    } else if (sameProfile(existing, desired.participant, desired.role)) unchangedProfiles += 1;
    else updateProfiles += 1;
  }

  let createHomes = 0;
  let updateHomes = 0;
  let unchangedHomes = 0;
  for (const [key, row] of desiredHomes) {
    const existing = existingHomesBySource.get(key);
    const hostId = existingProfilesBySource.get(profileSourceKey(row, "HOST"))?.id ?? null;
    if (!existing) createHomes += 1;
    else if (sameHome(existing, row.home, hostId)) unchangedHomes += 1;
    else updateHomes += 1;
  }

  let createMatches = 0;
  let updateMatches = 0;
  let unchangedMatches = 0;
  for (const [key, row] of desiredMatches) {
    const existing = existingMatchesBySource.get(key);
    const ids = {
      homeId: existingHomesBySource.get(sourceKey(row.sourceSystem, row.home.externalId))?.id ?? null,
      hostId: existingProfilesBySource.get(profileSourceKey(row, "HOST"))?.id ?? null,
      guestId: existingProfilesBySource.get(profileSourceKey(row, "GUEST"))?.id ?? null,
    };
    if (!existing) createMatches += 1;
    else if (sameMatch(existing, row, ids)) unchangedMatches += 1;
    else updateMatches += 1;
  }

  const eligibility = evaluateWeeklyEligibility({
    matches: [
      ...buildImportedEligibility(normalized.rows, input.existing),
      ...buildUntouchedExistingEligibility(normalized.rows, input.existing),
    ],
    asOfDate: input.asOfDate,
    alreadyCreatedParticipantIds: new Set(input.existing.invitationParticipantIds),
  });
  const errors = issues.filter((issue) => issue.severity === "ERROR");
  const duplicateCodes = new Set([
    "DUPLICATE_CONTRACT_SOURCE",
    "PROFILE_SOURCE_CONFLICT",
    "DUPLICATE_PROFILE_IDENTITY",
    "MULTIPLE_ACTIVE_MATCHES",
    "EXISTING_PROFILE_IDENTITY_CONFLICT",
    "PROFILE_ROLE_CONFLICT",
  ]);
  const counts = {
    sourceRows: parsed.rows.length,
    existingHosts: input.existing.profiles.filter((profile) => profile.profileType === "HOST").length,
    existingGuests: input.existing.profiles.filter((profile) => profile.profileType === "GUEST").length,
    existingHomes: input.existing.homes.length,
    existingActiveMatches: input.existing.matches.filter((match) => match.status === "ACTIVE").length,
    createProfiles,
    updateProfiles,
    unchangedProfiles,
    createHomes,
    updateHomes,
    unchangedHomes,
    createMatches,
    updateMatches,
    unchangedMatches,
    duplicateSuspects: new Set(
      issues.filter((issue) => duplicateCodes.has(issue.code)).map((issue) => `${issue.rowNumber}:${issue.code}`),
    ).size,
    missingRequired: errors.filter((issue) =>
      ["MISSING_REQUIRED", "MISSING_COLUMN_MAPPING"].includes(issue.code),
    ).length,
    activeUsersWithoutPhone: errors.filter((issue) => issue.code === "ACTIVE_PHONE_REQUIRED").length,
    invalidPhone: errors.filter((issue) => issue.code === "INVALID_PHONE").length,
    expectedWeeklyTargets: eligibility.eligible.length,
  };

  const planInput = {
    rows: normalized.rows,
    counts,
    existing: input.existing,
    asOfDate: input.asOfDate,
  };
  const issuesByRow = new Map<number, string[]>();
  for (const issue of issues) {
    issuesByRow.set(issue.rowNumber, [...(issuesByRow.get(issue.rowNumber) ?? []), issue.code]);
  }
  return {
    fileSha256: digest(input.csv),
    planSha256: digest(stableJson(planInput)),
    normalizedRows: normalized.rows,
    previewRows: normalized.rows.slice(0, 100).map((row) => ({
      rowNumber: row.rowNumber,
      contractExternalId: row.contract.externalId,
      contractStatus: row.contract.status,
      homeName: row.home.name,
      hostName: row.host.name,
      hostPhoneMasked: maskKoreanMobile(row.host.phone),
      guestName: row.guest.name,
      guestPhoneMasked: maskKoreanMobile(row.guest.phone),
      issueCodes: [...new Set(issuesByRow.get(row.rowNumber) ?? [])],
    })),
    issues,
    counts,
    canApply: errors.length === 0 && normalized.rows.length > 0,
  };
}
