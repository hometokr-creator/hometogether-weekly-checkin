import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { loadExistingImportSnapshotWithClient } from "@/lib/imports/service-role-operations";

type TestRow = Record<string, unknown>;

function fakeSupabase(tables: Record<string, TestRow[]>) {
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const client = {
    from(table: string) {
      const filters: Array<{ column: string; value: unknown }> = [];
      const filteredRows = () =>
        (tables[table] ?? []).filter((row) =>
          filters.every(({ column, value }) => row[column] === value),
        );
      const query = {
        select() {
          return query;
        },
        order() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return query;
        },
        async range(from: number, to: number) {
          ranges.push({ table, from, to });
          return { data: filteredRows().slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          return { data: filteredRows()[0] ?? null, error: null };
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, ranges };
}

function profile(index: number): TestRow {
  return {
    id: `profile-${index.toString().padStart(4, "0")}`,
    profile_type: index % 2 ? "HOST" : "GUEST",
    display_name: `사용자 ${index}`,
    phone: `+8210${index.toString().padStart(8, "0")}`,
    email: null,
    is_active: true,
    notification_enabled: true,
    source_system: "test",
    source_record_id: `profile-${index}`,
  };
}

describe("loadExistingImportSnapshotWithClient", () => {
  it("loads every snapshot collection and current invitation beyond 1000 rows", async () => {
    const runId = "run-current";
    const profiles = Array.from({ length: 1_205 }, (_, index) => profile(index));
    const homes = Array.from({ length: 1_101 }, (_, index) => ({
      id: `home-${index.toString().padStart(4, "0")}`,
      name: `집 ${index}`,
      address: null,
      city: "서울",
      district: null,
      is_active: true,
      host_profile_id: profiles[index % profiles.length].id,
      source_system: "test",
      source_record_id: `home-${index}`,
    }));
    const matches = Array.from({ length: 1_075 }, (_, index) => ({
      id: `match-${index.toString().padStart(4, "0")}`,
      home_id: homes[index % homes.length].id,
      host_id: profiles[(index * 2) % profiles.length].id,
      guest_id: profiles[(index * 2 + 1) % profiles.length].id,
      status: "ACTIVE",
      move_in_date: "2026-01-01",
      move_out_date: null,
      contract_end_date: null,
      source_system: "test",
      source_record_id: `match-${index}`,
    }));
    const invitations = Array.from({ length: 1_203 }, (_, index) => ({
      run_id: runId,
      participant_id: profiles[index].id,
    }));
    const { client, ranges } = fakeSupabase({
      profiles,
      homes,
      matches,
      weekly_checkin_runs: [{ id: runId, week_start: "2026-08-03" }],
      weekly_checkin_invitations: invitations,
    });

    const snapshot = await loadExistingImportSnapshotWithClient(client, "2026-08-07");

    expect(snapshot.profiles).toHaveLength(1_205);
    expect(snapshot.homes).toHaveLength(1_101);
    expect(snapshot.matches).toHaveLength(1_075);
    expect(snapshot.invitationParticipantIds).toHaveLength(1_203);
    for (const table of [
      "profiles",
      "homes",
      "matches",
      "weekly_checkin_invitations",
    ]) {
      expect(ranges.filter((range) => range.table === table).map(({ from, to }) => [from, to]))
        .toEqual([
          [0, 499],
          [500, 999],
          [1_000, 1_499],
        ]);
    }
  });
});
