import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ANONYMOUS_RLS_TARGETS,
  ORDINARY_PARTICIPANT_RLS_TARGETS,
  assertRedValidationIsSafe,
  getProductionConfiguration,
  PRODUCTION_RED_ACK,
  redactValidationSecrets,
  verifiedBoundaryVisibleRows,
} from "@/scripts/production-validation/lib";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.PRODUCTION_URL = "https://weekly-checkin.example.com";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-key-for-tests-only";
  process.env.SUPABASE_SECRET_KEY = "server-key-for-tests-only-do-not-use";
  process.env.PRODUCTION_VALIDATION_RUN_ID = "prod-test-20260807";
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("production validation safety rails", () => {
  it("refuses localhost as a claimed production URL", () => {
    process.env.PRODUCTION_URL = "http://localhost:3000";
    expect(() => getProductionConfiguration()).toThrow(/HTTPS|로컬/);
  });

  it("keeps temporary credentials outside the repository", () => {
    const config = getProductionConfiguration();
    expect(config.productionUrl).toBe("https://weekly-checkin.example.com");
    expect(config.stateFile).toContain("hometogether-production-validation-prod-test-20260807.json");
    expect(config.stateFile).not.toContain("outputs/hometogether-weekly-checkin");
  });

  it("requires an explicit assertion that RED test alerts are blocked", () => {
    delete process.env.PRODUCTION_VALIDATION_RED_SAFE;
    expect(() => assertRedValidationIsSafe()).toThrow(/RED 테스트/);

    process.env.PRODUCTION_VALIDATION_RED_SAFE = PRODUCTION_RED_ACK;
    expect(() => assertRedValidationIsSafe()).not.toThrow();
  });

  it("redacts both public and server Supabase keys from errors", () => {
    const redacted = redactValidationSecrets(
      "server-key-for-tests-only-do-not-use public-key-for-tests-only",
    );
    expect(redacted).toBe("[REDACTED_SUPABASE_SERVER_KEY] [REDACTED_SUPABASE_PUBLIC_KEY]");
  });

  it("queries legacy tables by their real primary-key columns", () => {
    expect(ANONYMOUS_RLS_TARGETS).toContainEqual({
      table: "app_members",
      column: "user_id",
      requireGrantDenied: false,
    });
    expect(ANONYMOUS_RLS_TARGETS.find((target) => target.table === "app_files")).toMatchObject({
      column: "id",
      requireGrantDenied: true,
    });
    expect(
      ANONYMOUS_RLS_TARGETS.find(
        (target) => target.table === "message_delivery_receipts",
      ),
    ).toMatchObject({ column: "id", requireGrantDenied: true });
  });

  it("requires the ordinary participant receipt grant to remain revoked", () => {
    expect(
      ORDINARY_PARTICIPANT_RLS_TARGETS.find(
        (target) => target.table === "message_delivery_receipts",
      ),
    ).toMatchObject({ column: "id", requireGrantDenied: true });
    expect(
      verifiedBoundaryVisibleRows({
        table: "message_delivery_receipts",
        requireGrantDenied: true,
        data: null,
        error: { code: "42501" },
        roleLabel: "일반 참가자",
      }),
    ).toBe(0);
    expect(() =>
      verifiedBoundaryVisibleRows({
        table: "message_delivery_receipts",
        requireGrantDenied: true,
        data: [],
        error: null,
        roleLabel: "일반 참가자",
      }),
    ).toThrow(/SELECT grant/);
  });
});
