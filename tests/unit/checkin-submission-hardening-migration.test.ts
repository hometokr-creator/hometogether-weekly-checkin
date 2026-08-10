import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809090321_harden_checkin_submission_transaction.sql",
  ),
  "utf8",
);

describe("check-in submission hardening migration", () => {
  it("serializes a match/run before reading the counterpart response", () => {
    const lock = migration.indexOf("pg_advisory_xact_lock");
    const counterpartRead = migration.indexOf("select response.risk_level");

    expect(lock).toBeGreaterThan(-1);
    expect(counterpartRead).toBeGreaterThan(lock);
    expect(migration).toContain("'weekly-checkin-submit:' || v_run_id::text");
    expect(migration).toContain("v_paired_mismatch := v_paired_mismatch or coalesce(");
  });

  it("preserves retry idempotency before paired reconciliation", () => {
    const completedGuard = migration.indexOf("if v_completed_at is not null then");
    const mismatchDerivation = migration.indexOf("v_paired_mismatch :=");

    expect(completedGuard).toBeGreaterThan(-1);
    expect(mismatchDerivation).toBeGreaterThan(completedGuard);
    expect(migration).toContain("'alreadyCompleted', v_result.already_completed");
  });

  it("promotes the GREEN side, records both signals, and remains service-role only", () => {
    expect(migration).toContain("when response.risk_level = 'GREEN' then 'YELLOW'");
    expect(migration).toContain("'PAIRED_MISMATCH'");
    expect(migration).toContain("on conflict (run_id, participant_id, signal_type) do nothing");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
