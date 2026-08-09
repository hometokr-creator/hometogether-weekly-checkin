import { describe, expect, it } from "vitest";

import {
  createDefaultColumnMapping,
  importFieldNames,
  type ExistingImportSnapshot,
  type ImportFieldName,
} from "@/lib/imports/contracts";
import { csvCell } from "@/lib/imports/csv";
import { createOperationalImportPlan } from "@/lib/imports/plan";

const emptySnapshot: ExistingImportSnapshot = {
  profiles: [],
  homes: [],
  matches: [],
  invitationParticipantIds: [],
};

function validValues(overrides: Partial<Record<ImportFieldName, string>> = {}) {
  return {
    source_system: "legacy-crm",
    contract_external_id: "contract-1",
    contract_status: "active",
    contract_start_date: "2026-01-01",
    contract_end_date: "2026-12-31",
    home_external_id: "home-1",
    home_name: "공동생활 1호",
    home_address: "",
    home_city: "서울특별시",
    home_district: "마포구",
    home_active: "true",
    host_external_id: "host-1",
    host_name: "집주인",
    host_phone: "010-1234-5678",
    host_email: "HOST@example.com",
    host_active: "true",
    host_notification_enabled: "true",
    guest_external_id: "guest-1",
    guest_name: "학생",
    guest_phone: "010-8765-4321",
    guest_email: "guest@example.com",
    guest_active: "true",
    guest_notification_enabled: "true",
    ...overrides,
  } satisfies Record<ImportFieldName, string>;
}

function csv(rows: Array<Record<ImportFieldName, string>>): string {
  return [
    importFieldNames.join(","),
    ...rows.map((row) => importFieldNames.map((field) => csvCell(row[field])).join(",")),
  ].join("\r\n");
}

function plan(rows: Array<Record<ImportFieldName, string>>, existing = emptySnapshot) {
  const content = csv(rows);
  return createOperationalImportPlan({
    csv: content,
    mapping: createDefaultColumnMapping(importFieldNames),
    existing,
    asOfDate: "2026-08-07",
  });
}

describe("operational import plan", () => {
  it("fails closed with an explicit issue for a header-only template", () => {
    const content = csv([]);
    const result = createOperationalImportPlan({
      csv: content,
      mapping: createDefaultColumnMapping(importFieldNames),
      existing: emptySnapshot,
      asOfDate: "2026-08-07",
    });
    expect(result.canApply).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("EMPTY_DATA");
  });

  it("produces a write-free create plan and two weekly targets", () => {
    const result = plan([validValues()]);
    expect(result.canApply).toBe(true);
    expect(result.counts).toMatchObject({
      sourceRows: 1,
      createProfiles: 2,
      createHomes: 1,
      createMatches: 1,
      duplicateSuspects: 0,
      missingRequired: 0,
      expectedWeeklyTargets: 2,
    });
    expect(result.normalizedRows[0].host).toMatchObject({
      phone: "+821012345678",
      email: "host@example.com",
    });
    expect(result.previewRows[0].hostPhoneMasked).toBe("010-****-5678");
    expect(result.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.planSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed when an active opted-in participant has no phone", () => {
    const result = plan([validValues({ guest_phone: "" })]);
    expect(result.canApply).toBe(false);
    expect(result.counts.activeUsersWithoutPhone).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toContain("ACTIVE_PHONE_REQUIRED");
  });

  it("blocks separate source users that share a phone", () => {
    const result = plan([
      validValues(),
      validValues({
        contract_external_id: "contract-2",
        home_external_id: "home-2",
        guest_external_id: "guest-2",
        guest_phone: "010-1234-5678",
      }),
    ]);
    expect(result.canApply).toBe(false);
    expect(result.counts.duplicateSuspects).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain("DUPLICATE_PROFILE_IDENTITY");
  });

  it("classifies an exact source replay as unchanged", () => {
    const existing: ExistingImportSnapshot = {
      profiles: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          profileType: "HOST",
          displayName: "집주인",
          phone: "+821012345678",
          email: "host@example.com",
          active: true,
          notificationEnabled: true,
          sourceSystem: "legacy-crm",
          sourceRecordId: "host-1",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          profileType: "GUEST",
          displayName: "학생",
          phone: "+821087654321",
          email: "guest@example.com",
          active: true,
          notificationEnabled: true,
          sourceSystem: "legacy-crm",
          sourceRecordId: "guest-1",
        },
      ],
      homes: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "공동생활 1호",
          address: null,
          city: "서울특별시",
          district: "마포구",
          active: true,
          hostProfileId: "11111111-1111-4111-8111-111111111111",
          sourceSystem: "legacy-crm",
          sourceRecordId: "home-1",
        },
      ],
      matches: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          homeId: "33333333-3333-4333-8333-333333333333",
          hostId: "11111111-1111-4111-8111-111111111111",
          guestId: "22222222-2222-4222-8222-222222222222",
          status: "ACTIVE",
          startDate: "2026-01-01",
          moveOutDate: null,
          endDate: "2026-12-31",
          sourceSystem: "legacy-crm",
          sourceRecordId: "contract-1",
        },
      ],
      invitationParticipantIds: [],
    };
    const result = plan([validValues()], existing);
    expect(result.canApply).toBe(true);
    expect(result.counts).toMatchObject({
      createProfiles: 0,
      updateProfiles: 0,
      unchangedProfiles: 2,
      createHomes: 0,
      updateHomes: 0,
      unchangedHomes: 1,
      createMatches: 0,
      updateMatches: 0,
      unchangedMatches: 1,
    });
  });
});
