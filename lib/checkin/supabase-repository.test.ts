import { beforeEach, describe, expect, it, vi } from "vitest";

const adminClientMock = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClientMock.client,
}));

import { QUESTIONNAIRE_VERSION } from "@/lib/checkin/types";
import { SupabaseCheckinRepository } from "@/lib/checkin/supabase-repository";

type TestRow = Record<string, unknown>;
type QueryResult = { data: TestRow[]; error: null };

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<{
    column: string;
    predicate: (value: unknown) => boolean;
  }> = [];
  private orderColumn: string | undefined;
  private orderAscending = true;
  private rowLimit: number | undefined;

  constructor(
    private readonly table: string,
    private readonly source: TestRow[],
    private readonly ranges: Array<{ table: string; from: number; to: number }>,
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, expected: unknown): this {
    this.filters.push({ column, predicate: (value) => value === expected });
    return this;
  }

  lte(column: string, expected: string): this {
    this.filters.push({
      column,
      predicate: (value) => typeof value === "string" && value <= expected,
    });
    return this;
  }

  gt(column: string, expected: string): this {
    this.filters.push({
      column,
      predicate: (value) => typeof value === "string" && value > expected,
    });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  limit(count: number): this {
    this.rowLimit = count;
    return this;
  }

  async range(from: number, to: number): Promise<QueryResult> {
    this.ranges.push({ table: this.table, from, to });
    return { data: this.rows().slice(from, to + 1), error: null };
  }

  async maybeSingle(): Promise<{ data: TestRow | null; error: null }> {
    return { data: this.rows()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: TestRow; error: null }> {
    return { data: this.rows()[0], error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows(), error: null }).then(onfulfilled, onrejected);
  }

  private rows(): TestRow[] {
    const rows = this.source.filter((row) =>
      this.filters.every(({ column, predicate }) => predicate(row[column])),
    );
    if (this.orderColumn) {
      const column = this.orderColumn;
      rows.sort((left, right) => {
        const compared = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
        return this.orderAscending ? compared : -compared;
      });
    }
    return this.rowLimit === undefined ? rows : rows.slice(0, this.rowLimit);
  }
}

function fakeSupabase(tables: Record<string, TestRow[]>) {
  const ranges: Array<{ table: string; from: number; to: number }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return new FakeQuery(table, tables[table] ?? [], ranges);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "create_weekly_checkin_batch") {
        const candidates = args.p_candidates as Array<Record<string, unknown>>;
        return {
          data: candidates.map((candidate, index) => ({
            ...candidate,
            run_id: "run-current",
            invitation_id: `${rpcCalls.length}-${index}`,
          })),
          error: null,
        };
      }
      if (name === "enqueue_weekly_checkin_reminders") {
        return { data: 1, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, ranges, rpcCalls };
}

function id(prefix: string, index: number): string {
  return `${prefix}-${index.toString().padStart(5, "0")}`;
}

function activeMatch(index: number): TestRow {
  const hostId = id("host", index);
  const guestId = id("guest", index);
  return {
    id: id("match", index),
    host_id: hostId,
    guest_id: guestId,
    status: "ACTIVE",
    move_in_date: "2026-01-01",
    move_out_date: null,
    contract_end_date: null,
    home: [{ is_active: true }],
    host: [
      {
        id: hostId,
        is_active: true,
        notification_enabled: true,
        phone: `+8210${(index * 2).toString().padStart(8, "0")}`,
      },
    ],
    guest: [
      {
        id: guestId,
        is_active: true,
        notification_enabled: true,
        phone: `+8210${(index * 2 + 1).toString().padStart(8, "0")}`,
      },
    ],
  };
}

function dashboardTables(count: number): Record<string, TestRow[]> {
  const invitations = Array.from({ length: count }, (_, index) => ({
    id: id("invitation", index),
    run_id: "run-current",
    match_id: id("match", index),
    participant_id: id("participant", index),
    role: index % 2 ? "HOST" : "GUEST",
    status: "COMPLETED",
    is_test: false,
    participant: [{ display_name: `사용자 ${index}` }],
    run: [{ week_start: "2026-08-03", week_end: "2026-08-09" }],
  }));
  const responses = invitations.map((invitation, index) => ({
    id: id("response", index),
    invitation_id: invitation.id,
    match_id: invitation.match_id,
    participant_id: invitation.participant_id,
    role: invitation.role,
    answers_json: {
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      overallStatus: "GOOD",
      issueStatus: "NO_ISSUE",
      positivePoints: ["NO_SPECIAL_EVENT"],
      issues: [],
      questionSnapshot: {},
    },
    risk_level: "GREEN",
    risk_reasons: [],
    paired_mismatch: false,
    submitted_at: `2026-08-07T00:00:${(index % 60).toString().padStart(2, "0")}.000Z`,
    is_test: false,
  }));
  return {
    weekly_checkin_invitations: invitations,
    weekly_checkin_responses: responses,
    support_cases: responses.map((response, index) => ({
      id: id("case", index),
      response_id: response.id,
      match_id: response.match_id,
      participant_id: response.participant_id,
      priority: "GREEN",
      status: "OPEN",
      events: [],
      created_at: "2026-08-07T00:00:00.000Z",
      is_test: false,
    })),
    support_case_events: responses.map((_, index) => ({
      id: id("event", index),
      support_case_id: id("case", index),
      action: "CREATED",
      admin_id: null,
      created_at: "2026-08-07T00:00:00.000Z",
    })),
    message_logs: invitations.map((invitation) => ({
      id: `message-${invitation.id}`,
      invitation_id: invitation.id,
      status: "SENT",
      message_type: "WEEKLY_CHECKIN",
      is_test: false,
    })),
    weekly_checkin_runs: [
      { id: "run-current", week_start: "2026-08-03", week_end: "2026-08-09" },
    ],
    weekly_checkin_signals: invitations.map((invitation, index) => ({
      id: id("signal", index),
      run_id: "run-current",
      invitation_id: invitation.id,
      signal_type: "REPEATED_SUBCATEGORY",
      is_test: false,
    })),
  };
}

describe("SupabaseCheckinRepository pagination", () => {
  beforeEach(() => {
    adminClientMock.client = undefined;
  });

  it("loads every eligible match and chunks the 2000-candidate RPC boundary", async () => {
    const fake = fakeSupabase({
      matches: Array.from({ length: 1_050 }, (_, index) => activeMatch(index)),
    });
    adminClientMock.client = fake.client;
    const repository = new SupabaseCheckinRepository();

    await expect(repository.enqueueWeeklyMessages(new Date("2026-08-02T00:00:00.000Z")))
      .resolves.toEqual({ queued: 2_100, dataQualityCount: 0 });

    expect(fake.ranges.filter((range) => range.table === "matches")).toEqual([
      { table: "matches", from: 0, to: 499 },
      { table: "matches", from: 500, to: 999 },
      { table: "matches", from: 1_000, to: 1_499 },
    ]);
    const batches = fake.rpcCalls.filter((call) => call.name === "create_weekly_checkin_batch");
    expect(batches.map((call) => (call.args.p_candidates as unknown[]).length)).toEqual([
      2_000,
      100,
    ]);
  });

  it("loads and enqueues every due reminder run beyond 1000 rows", async () => {
    const now = new Date("2026-08-07T00:00:00.000Z");
    const fake = fakeSupabase({
      weekly_checkin_runs: Array.from({ length: 1_205 }, (_, index) => ({
        id: id("run", index),
        reminder_at: "2026-08-06T00:00:00.000Z",
        expires_at: "2026-08-08T00:00:00.000Z",
      })),
    });
    adminClientMock.client = fake.client;
    const repository = new SupabaseCheckinRepository();

    await expect(repository.enqueueReminderMessages(now)).resolves.toEqual({
      queued: 1_205,
      dataQualityCount: 0,
    });
    expect(
      fake.rpcCalls.filter((call) => call.name === "enqueue_weekly_checkin_reminders"),
    ).toHaveLength(1_205);
    expect(fake.ranges.filter((range) => range.table === "weekly_checkin_runs"))
      .toHaveLength(3);
  });

  it("builds a complete dashboard when each collection exceeds 1000 rows", async () => {
    const fake = fakeSupabase(dashboardTables(1_205));
    adminClientMock.client = fake.client;
    const repository = new SupabaseCheckinRepository();

    const dashboard = await repository.getDashboard();

    expect(dashboard.responses).toHaveLength(1_205);
    expect(dashboard.supportCases).toHaveLength(1_205);
    expect(dashboard.stats).toMatchObject({
      targetCount: 1_205,
      completedCount: 1_205,
      repeatedIssueCount: 1_205,
    });
    for (const table of [
      "weekly_checkin_invitations",
      "weekly_checkin_responses",
      "support_cases",
      "support_case_events",
      "message_logs",
      "weekly_checkin_signals",
    ]) {
      expect(fake.ranges.filter((range) => range.table === table)).toHaveLength(3);
    }
  });

  it("uses keyed detail queries instead of scanning the dashboard", async () => {
    const tables = dashboardTables(1);
    tables.weekly_checkin_invitations[0].is_test = true;
    const fake = fakeSupabase(tables);
    adminClientMock.client = fake.client;
    const repository = new SupabaseCheckinRepository();

    const response = await repository.getResponse("response-00000");
    const supportCase = await repository.getSupportCase("case-00000");

    expect(response).toMatchObject({
      id: "response-00000",
      recipientName: "사용자 0",
      isTest: true,
      supportCase: { id: "case-00000", isTest: true },
    });
    expect(supportCase).toMatchObject({ id: "case-00000", isTest: true });
    expect(fake.ranges).toEqual([
      { table: "support_case_events", from: 0, to: 499 },
      { table: "support_case_events", from: 0, to: 499 },
    ]);
  });
});
