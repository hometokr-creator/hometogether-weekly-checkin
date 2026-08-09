import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PRODUCTION_WRITE_ACK = "I_ACKNOWLEDGE_PRODUCTION_TEST_WRITES";
export const PRODUCTION_RED_ACK = "I_CONFIRMED_TEST_ALERTS_ARE_BLOCKED";

export const validationScenarios = [
  "normal",
  "cleanliness",
  "safety",
  "duplicate",
  "expired",
] as const;

export type ValidationScenario = (typeof validationScenarios)[number];

type ScenarioSecrets = {
  invitationId: string;
  matchId: string;
  participantId: string;
  participantName: string;
  token: string;
};

export type ProductionValidationState = {
  schemaVersion: 1;
  runTag: string;
  productionUrl: string;
  supabaseHost: string;
  createdAt: string;
  seededAt?: string;
  fixtureIds: {
    homeId: string;
    hostProfileId: string;
    profileIds: string[];
    matchIds: string[];
    runIds: string[];
  };
  scenarios: Record<ValidationScenario, ScenarioSecrets>;
  admin?: {
    userId: string;
    email: string;
    password: string;
  };
  participantAccount?: {
    userId: string;
    email: string;
    password: string;
  };
  verified?: {
    verifiedAt: string;
    responseIds: Partial<Record<ValidationScenario, string>>;
    supportCaseId?: string;
  };
};

type ProductionConfiguration = {
  productionUrl: string;
  supabaseUrl: string;
  serviceKey: string;
  publishableKey: string;
  runTag: string;
  stateFile: string;
};

export type ProductionVerificationReport = {
  runTag: string;
  verifiedAt: string;
  responseIds: Partial<Record<ValidationScenario, string>>;
  supportCaseId?: string;
  risks: Partial<Record<ValidationScenario, string>>;
  issueCount: number;
  messageCount: number;
  anonymousRawRowCount: number;
};

const TEST_TABLES = [
  "weekly_checkin_runs",
  "weekly_checkin_invitations",
  "weekly_checkin_responses",
  "support_cases",
] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`필수 환경변수가 없습니다: ${name}`);
  return value;
}

function normalizeHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 값이 올바른 URL이 아닙니다.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label}는 HTTPS 주소여야 합니다.`);
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error(`${label}에 로컬 주소를 사용할 수 없습니다.`);
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function getProductionConfiguration(): ProductionConfiguration {
  const productionUrl = normalizeHttpsUrl(required("PRODUCTION_URL"), "PRODUCTION_URL");
  const supabaseUrl = normalizeHttpsUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? required("SUPABASE_URL"),
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  if (!serviceKey) {
    throw new Error("SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  }
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY가 필요합니다.",
    );
  }
  if (serviceKey === publishableKey) {
    throw new Error("Supabase 공개 키와 서버 키가 같을 수 없습니다.");
  }

  const runTag = required("PRODUCTION_VALIDATION_RUN_ID");
  if (!/^[A-Za-z0-9_-]{6,48}$/.test(runTag)) {
    throw new Error("PRODUCTION_VALIDATION_RUN_ID는 영문, 숫자, _-로 된 6~48자여야 합니다.");
  }

  return {
    productionUrl,
    supabaseUrl,
    serviceKey,
    publishableKey,
    runTag,
    stateFile: join(tmpdir(), `hometogether-production-validation-${runTag}.json`),
  };
}

function serviceClient(config: ProductionConfiguration): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function anonymousClient(config: ProductionConfiguration): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function deterministicUuid(runTag: string, label: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`${runTag}:${label}`).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function plusDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function validationWeek(runTag: string, offsetWeeks = 0): { start: string; end: string } {
  const seed = Number.parseInt(createHash("sha256").update(runTag).digest("hex").slice(0, 6), 16);
  const start = new Date(Date.UTC(2080, 0, 7 + (seed % 5_000) + offsetWeeks * 7));
  const day = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() + ((8 - day) % 7));
  return { start: dateOnly(start), end: dateOnly(plusDays(start, 6)) };
}

function scenarioRecord(runTag: string): Record<ValidationScenario, ScenarioSecrets> {
  return Object.fromEntries(
    validationScenarios.map((scenario) => [
      scenario,
      {
        invitationId: deterministicUuid(runTag, `${scenario}:invitation`),
        matchId: deterministicUuid(runTag, `${scenario}:match`),
        participantId: deterministicUuid(runTag, `${scenario}:participant`),
        participantName: `[TEST:${runTag}] ${scenario}`,
        token: randomBytes(32).toString("base64url"),
      },
    ]),
  ) as Record<ValidationScenario, ScenarioSecrets>;
}

async function saveState(state: ProductionValidationState, createOnly = false): Promise<void> {
  const config = getProductionConfiguration();
  if (state.runTag !== config.runTag || state.productionUrl !== config.productionUrl) {
    throw new Error("검증 상태 파일의 실행 ID 또는 Production URL이 현재 환경과 다릅니다.");
  }
  await writeFile(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: createOnly ? "wx" : "w",
  });
  await chmod(config.stateFile, 0o600);
}

export async function readValidationState(): Promise<ProductionValidationState> {
  const config = getProductionConfiguration();
  let text: string;
  try {
    text = await readFile(config.stateFile, "utf8");
  } catch {
    throw new Error(
      `검증 상태 파일이 없습니다. 먼저 seed를 실행하세요: ${config.stateFile}`,
    );
  }
  const state = JSON.parse(text) as ProductionValidationState;
  if (
    state.schemaVersion !== 1 ||
    state.runTag !== config.runTag ||
    state.productionUrl !== config.productionUrl ||
    state.supabaseHost !== new URL(config.supabaseUrl).host
  ) {
    throw new Error("검증 상태 파일이 현재 production 환경과 일치하지 않습니다.");
  }
  for (const scenario of validationScenarios) {
    if (!state.scenarios[scenario]?.token) throw new Error("검증 상태 파일이 완전하지 않습니다.");
  }
  return state;
}

function assertProductionWriteAcknowledged(): void {
  if (process.env.PRODUCTION_VALIDATION_ACK !== PRODUCTION_WRITE_ACK) {
    throw new Error(
      `원격 테스트 데이터 생성을 승인하려면 PRODUCTION_VALIDATION_ACK=${PRODUCTION_WRITE_ACK}를 설정하세요.`,
    );
  }
}

export function assertRedValidationIsSafe(): void {
  if (process.env.PRODUCTION_VALIDATION_RED_SAFE !== PRODUCTION_RED_ACK) {
    throw new Error(
      `RED 테스트 전 외부 CRM/관리자 알림 차단을 확인하고 PRODUCTION_VALIDATION_RED_SAFE=${PRODUCTION_RED_ACK}를 설정하세요.`,
    );
  }
}

async function assertTestIsolationSchema(client: SupabaseClient): Promise<void> {
  for (const table of TEST_TABLES) {
    const { error } = await client.from(table).select("id,is_test").limit(1);
    if (error) {
      throw new Error(`원격 스키마에 필수 테스트 격리 컬럼이 없습니다: ${table}.is_test`);
    }
  }
}

export async function runProductionPreflight(options: { write?: boolean } = {}): Promise<{
  productionUrl: string;
  supabaseHost: string;
  runTag: string;
  stateFile: string;
}> {
  const config = getProductionConfiguration();
  if (options.write) assertProductionWriteAcknowledged();

  const response = await fetch(config.productionUrl, {
    redirect: "manual",
    headers: { "user-agent": "HomeTogether-Production-Validation/1.0" },
  });
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`Production URL health check가 실패했습니다. HTTP ${response.status}`);
  }

  await assertTestIsolationSchema(serviceClient(config));
  return {
    productionUrl: config.productionUrl,
    supabaseHost: new URL(config.supabaseUrl).host,
    runTag: config.runTag,
    stateFile: config.stateFile,
  };
}

function databaseFailure(context: string, error: { code?: string } | null): never {
  const code = error?.code ? ` (${error.code})` : "";
  throw new Error(`${context}에 실패했습니다${code}. 민감한 DB 오류 상세는 출력하지 않았습니다.`);
}

async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const { error } = await client.from(table).insert(rows);
  if (error) databaseFailure(`${table} 테스트 행 생성`, error);
}

export async function seedProductionValidation(): Promise<ProductionValidationState> {
  const config = getProductionConfiguration();
  await runProductionPreflight({ write: true });

  try {
    const existing = await readValidationState();
    if (existing.seededAt) return existing;
    await cleanupProductionValidation();
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    if (
      !(error instanceof Error) ||
      !error.message.startsWith("검증 상태 파일이 없습니다")
    ) {
      throw error;
    }
  }

  const scenarios = scenarioRecord(config.runTag);
  const activeWeek = validationWeek(config.runTag);
  const expiredWeek = validationWeek(config.runTag, -1);
  const now = new Date();
  const activeRunId = deterministicUuid(config.runTag, "active:run");
  const expiredRunId = deterministicUuid(config.runTag, "expired:run");
  const homeId = deterministicUuid(config.runTag, "home");
  const hostProfileId = deterministicUuid(config.runTag, "host");
  const state: ProductionValidationState = {
    schemaVersion: 1,
    runTag: config.runTag,
    productionUrl: config.productionUrl,
    supabaseHost: new URL(config.supabaseUrl).host,
    createdAt: now.toISOString(),
    fixtureIds: {
      homeId,
      hostProfileId,
      profileIds: [hostProfileId, ...validationScenarios.map((name) => scenarios[name].participantId)],
      matchIds: validationScenarios.map((name) => scenarios[name].matchId),
      runIds: [activeRunId, expiredRunId],
    },
    scenarios,
  };

  await saveState(state, true);
  const client = serviceClient(config);

  try {
    await insertRows(client, "profiles", [
      {
        id: hostProfileId,
        profile_type: "HOST",
        display_name: `[TEST:${config.runTag}] host`,
        phone: "+19995550100",
        is_active: true,
      },
      ...validationScenarios.map((scenario, index) => ({
        id: scenarios[scenario].participantId,
        profile_type: "GUEST",
        display_name: scenarios[scenario].participantName,
        phone: `+19995550${String(101 + index).padStart(3, "0")}`,
        is_active: true,
      })),
    ]);
    await insertRows(client, "homes", [
      {
        id: homeId,
        name: `[TEST:${config.runTag}] automated validation only`,
        city: null,
        district: null,
        is_active: true,
      },
    ]);
    await insertRows(
      client,
      "matches",
      validationScenarios.map((scenario) => ({
        id: scenarios[scenario].matchId,
        home_id: homeId,
        host_id: hostProfileId,
        guest_id: scenarios[scenario].participantId,
        status: "ACTIVE",
        move_in_date: "2070-01-01",
        contract_end_date: "2099-12-31",
      })),
    );
    await insertRows(client, "weekly_checkin_runs", [
      {
        id: activeRunId,
        week_start: activeWeek.start,
        week_end: activeWeek.end,
        send_at: plusDays(now, -1 / 24).toISOString(),
        reminder_at: plusDays(now, 1 / 24).toISOString(),
        expires_at: plusDays(now, 1).toISOString(),
        status: "COMPLETED",
        is_test: true,
      },
      {
        id: expiredRunId,
        week_start: expiredWeek.start,
        week_end: expiredWeek.end,
        send_at: plusDays(now, -4).toISOString(),
        reminder_at: plusDays(now, -3).toISOString(),
        expires_at: plusDays(now, -2).toISOString(),
        status: "COMPLETED",
        is_test: true,
      },
    ]);
    await insertRows(
      client,
      "weekly_checkin_invitations",
      validationScenarios.map((scenario) => {
        const expired = scenario === "expired";
        return {
          id: scenarios[scenario].invitationId,
          run_id: expired ? expiredRunId : activeRunId,
          match_id: scenarios[scenario].matchId,
          participant_id: scenarios[scenario].participantId,
          role: "GUEST",
          token_hash: tokenHash(scenarios[scenario].token),
          status: expired ? "EXPIRED" : "SENT",
          sent_at: expired ? plusDays(now, -4).toISOString() : now.toISOString(),
          expires_at: expired ? plusDays(now, -2).toISOString() : plusDays(now, 1).toISOString(),
          created_at: expired ? plusDays(now, -5).toISOString() : now.toISOString(),
          is_test: true,
        };
      }),
    );

    const participantPassword = randomBytes(36).toString("base64url");
    const accountSuffix = createHash("sha256")
      .update(config.runTag)
      .digest("hex")
      .slice(0, 20);
    const participantEmail = `e2e-p-${accountSuffix}@example.invalid`;
    const { data: createdParticipant, error: participantError } =
      await client.auth.admin.createUser({
        email: participantEmail,
        password: participantPassword,
        email_confirm: true,
        app_metadata: { is_test: true, validation_run: config.runTag, role: "GUEST" },
      });
    if (participantError || !createdParticipant.user) {
      databaseFailure("임시 일반 참가자 계정 생성", participantError);
    }
    state.participantAccount = {
      userId: createdParticipant.user.id,
      email: participantEmail,
      password: participantPassword,
    };
    await saveState(state);
    const { error: participantProfileError } = await client
      .from("profiles")
      .update({ auth_user_id: state.participantAccount.userId })
      .eq("id", scenarios.normal.participantId);
    if (participantProfileError) {
      databaseFailure("일반 참가자 인증 프로필 연결", participantProfileError);
    }

    const adminPassword = randomBytes(36).toString("base64url");
    const adminEmail = `e2e-a-${accountSuffix}@example.invalid`;
    const { data: createdAdmin, error: adminError } = await client.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      app_metadata: { is_test: true, validation_run: config.runTag },
    });
    if (adminError || !createdAdmin.user) databaseFailure("임시 테스트 관리자 생성", adminError);
    state.admin = {
      userId: createdAdmin.user.id,
      email: adminEmail,
      password: adminPassword,
    };
    await saveState(state);
    await insertRows(client, "admin_memberships", [
      {
        user_id: state.admin.userId,
        permissions: ["CHECKIN_READ", "SAFETY_READ", "CASE_WRITE"],
        is_active: true,
      },
    ]);
    state.seededAt = new Date().toISOString();
    await saveState(state);
    return state;
  } catch (error) {
    await cleanupProductionValidation({ keepStateOnFailure: true }).catch(() => undefined);
    throw error;
  }
}

async function selectIds(
  client: SupabaseClient,
  table: string,
  column: string,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return [];
  const { data, error } = await client.from(table).select("id").in(column, values);
  if (error) databaseFailure(`${table} 정리 대상 확인`, error);
  return (data ?? []).flatMap((row) =>
    typeof row.id === "string" ? [row.id] : [],
  );
}

async function deleteExact(
  client: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  requireIsTest = false,
): Promise<void> {
  if (values.length === 0) return;
  let query = client.from(table).delete().in(column, values);
  if (requireIsTest) query = query.eq("is_test", true);
  const { error } = await query;
  if (error) databaseFailure(`${table} 테스트 행 정리`, error);
}

export async function cleanupProductionValidation(
  options: { keepStateOnFailure?: boolean } = {},
): Promise<{ runTag: string; stateRemoved: boolean }> {
  const config = getProductionConfiguration();
  assertProductionWriteAcknowledged();
  const state = await readValidationState();
  const client = serviceClient(config);
  const invitationIds = validationScenarios.map((name) => state.scenarios[name].invitationId);
  const responseIds = await selectIds(
    client,
    "weekly_checkin_responses",
    "invitation_id",
    invitationIds,
  );
  const caseIds = await selectIds(client, "support_cases", "response_id", responseIds);

  try {
    await deleteExact(client, "audit_logs", "entity_id", [...caseIds, ...responseIds]);
    await deleteExact(client, "integration_outbox", "aggregate_id", [...caseIds, ...responseIds]);
    await deleteExact(client, "support_cases", "id", caseIds, true);
    await deleteExact(client, "weekly_checkin_responses", "id", responseIds, true);
    await deleteExact(client, "message_logs", "invitation_id", invitationIds);
    await deleteExact(client, "weekly_checkin_signals", "run_id", state.fixtureIds.runIds);
    await deleteExact(client, "weekly_checkin_drafts", "invitation_id", invitationIds);
    await deleteExact(client, "weekly_checkin_invitations", "id", invitationIds, true);
    await deleteExact(client, "weekly_checkin_runs", "id", state.fixtureIds.runIds, true);
    await deleteExact(client, "matches", "id", state.fixtureIds.matchIds);
    await deleteExact(client, "homes", "id", [state.fixtureIds.homeId]);
    await deleteExact(client, "profiles", "id", state.fixtureIds.profileIds);

    for (const account of [state.admin, state.participantAccount]) {
      if (!account) continue;
      const { data: accountLookup, error: accountLookupError } =
        await client.auth.admin.getUserById(account.userId);
      if (accountLookupError && accountLookupError.status !== 404) {
        databaseFailure("테스트 인증 계정 확인", accountLookupError);
      }
      if (!accountLookup.user) continue;
      const metadata = accountLookup.user.app_metadata;
      if (metadata?.is_test !== true || metadata?.validation_run !== state.runTag) {
        throw new Error("테스트 표식이 없는 인증 계정 삭제를 거부했습니다.");
      }
      const { error: deleteAccountError } = await client.auth.admin.deleteUser(account.userId);
      if (deleteAccountError) databaseFailure("테스트 인증 계정 정리", deleteAccountError);
    }

    await unlink(config.stateFile);
    return { runTag: state.runTag, stateRemoved: true };
  } catch (error) {
    if (!options.keepStateOnFailure) throw error;
    return { runTag: state.runTag, stateRemoved: false };
  }
}

function ensureSingle<T>(rows: T[], description: string): T {
  if (rows.length !== 1) throw new Error(`${description} 행 수가 1이 아닙니다: ${rows.length}`);
  return rows[0];
}

export async function verifyAnonymousRls(): Promise<number> {
  const config = getProductionConfiguration();
  const client = anonymousClient(config);
  let visibleRows = 0;
  for (const { table, requireGrantDenied = false } of [
    { table: "app_files", requireGrantDenied: true },
    { table: "app_members" },
    { table: "app_records" },
    { table: "weekly_checkin_invitations" },
    { table: "weekly_checkin_responses" },
    { table: "weekly_checkin_issues" },
    { table: "support_cases" },
    { table: "message_logs" },
    { table: "audit_logs" },
  ]) {
    const { data, error } = await client.from(table).select("id").limit(5);
    // A table-level 42501 is an even stricter boundary than an empty RLS
    // result: anon has no SELECT grant at all. Treat that as zero visible rows.
    if (error?.code === "42501") continue;
    if (error) databaseFailure(`${table} anonymous RLS 확인`, error);
    if (requireGrantDenied) {
      throw new Error(`${table} anonymous SELECT grant가 회수되지 않았습니다.`);
    }
    visibleRows += data?.length ?? 0;
  }
  if (visibleRows !== 0) throw new Error("anonymous 역할에서 비공개 원본 행이 조회됩니다.");
  return visibleRows;
}

export async function verifyOrdinaryParticipantBoundaries(): Promise<{
  visibleRawRows: number;
  isAdmin: boolean;
  adminApiStatus: number;
}> {
  const config = getProductionConfiguration();
  const state = await readValidationState();
  if (!state.participantAccount) throw new Error("일반 참가자 테스트 계정이 없습니다.");
  const client = anonymousClient(config);
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: state.participantAccount.email,
    password: state.participantAccount.password,
  });
  if (authError || !authData.session) databaseFailure("일반 참가자 로그인", authError);

  try {
    let visibleRawRows = 0;
    for (const table of [
      "weekly_checkin_invitations",
      "weekly_checkin_responses",
      "weekly_checkin_issues",
      "support_cases",
      "message_logs",
      "audit_logs",
    ]) {
      const { data, error } = await client.from(table).select("id").limit(5);
      if (error) databaseFailure(`${table} 일반 참가자 RLS 확인`, error);
      visibleRawRows += data?.length ?? 0;
    }
    if (visibleRawRows !== 0) {
      throw new Error("일반 참가자가 비공개 체크인 원본 행을 조회할 수 있습니다.");
    }
    const { data: isAdmin, error: isAdminError } = await client.rpc("is_admin", {
      required_permission: "CHECKIN_READ",
    });
    if (isAdminError) databaseFailure("일반 참가자 관리자 권한 확인", isAdminError);
    if (isAdmin === true) throw new Error("일반 참가자 계정이 관리자로 판정됐습니다.");

    const adminApi = await fetch(`${config.productionUrl}/api/admin/support-cases`, {
      headers: { authorization: `Bearer ${authData.session.access_token}` },
      redirect: "manual",
    });
    if (![401, 403].includes(adminApi.status)) {
      throw new Error(`일반 참가자의 관리자 API 요청이 차단되지 않았습니다: ${adminApi.status}`);
    }
    return { visibleRawRows, isAdmin: false, adminApiStatus: adminApi.status };
  } finally {
    await client.auth.signOut();
  }
}

export async function verifyProductionData(): Promise<ProductionVerificationReport> {
  const config = getProductionConfiguration();
  const state = await readValidationState();
  const client = serviceClient(config);
  await assertTestIsolationSchema(client);

  const invitationIds = validationScenarios.map((name) => state.scenarios[name].invitationId);
  const { data: responseData, error: responseError } = await client
    .from("weekly_checkin_responses")
    .select("id,invitation_id,risk_level,is_test")
    .in("invitation_id", invitationIds);
  if (responseError) databaseFailure("production response 조회", responseError);
  const responses = responseData ?? [];
  const byInvitation = new Map(responses.map((row) => [row.invitation_id, row]));
  const expectedRisks: Partial<Record<ValidationScenario, string>> = {
    normal: "GREEN",
    cleanliness: "YELLOW",
    safety: "RED",
    duplicate: "GREEN",
  };
  const responseIds: Partial<Record<ValidationScenario, string>> = {};
  const risks: Partial<Record<ValidationScenario, string>> = {};

  for (const scenario of ["normal", "cleanliness", "safety", "duplicate"] as const) {
    const row = byInvitation.get(state.scenarios[scenario].invitationId);
    if (!row) throw new Error(`${scenario} production response가 없습니다.`);
    if (row.is_test !== true) throw new Error(`${scenario} response에 is_test가 상속되지 않았습니다.`);
    if (row.risk_level !== expectedRisks[scenario]) {
      throw new Error(`${scenario} 서버 위험도가 예상과 다릅니다: ${String(row.risk_level)}`);
    }
    responseIds[scenario] = String(row.id);
    risks[scenario] = String(row.risk_level);
  }
  if (byInvitation.has(state.scenarios.expired.invitationId)) {
    throw new Error("만료 invitation에서 response가 생성됐습니다.");
  }

  const cleanlinessResponseId = responseIds.cleanliness!;
  const { data: issues, error: issueError } = await client
    .from("weekly_checkin_issues")
    .select("id,category,subcategory,severity")
    .eq("response_id", cleanlinessResponseId);
  if (issueError) databaseFailure("production issue 조회", issueError);
  const cleanlinessIssue = ensureSingle(issues ?? [], "cleanliness issue");
  if (
    cleanlinessIssue.category !== "CLEANLINESS" ||
    cleanlinessIssue.subcategory !== "BATHROOM_CLEANING" ||
    cleanlinessIssue.severity !== 3
  ) {
    throw new Error("위생 issue가 제출 내용대로 저장되지 않았습니다.");
  }

  const { data: caseRows, error: caseError } = await client
    .from("support_cases")
    .select("id,response_id,priority,status,is_test")
    .in("response_id", Object.values(responseIds));
  if (caseError) databaseFailure("production support case 조회", caseError);
  const supportCase = ensureSingle(caseRows ?? [], "RED support case");
  if (
    supportCase.response_id !== responseIds.safety ||
    supportCase.priority !== "RED" ||
    supportCase.status !== "UNACKNOWLEDGED" ||
    supportCase.is_test !== true
  ) {
    throw new Error("RED support case의 우선순위, 상태 또는 is_test 상속이 올바르지 않습니다.");
  }

  const { data: messageRows, error: messageError } = await client
    .from("message_logs")
    .select("id")
    .in("invitation_id", invitationIds);
  if (messageError) databaseFailure("테스트 invitation 메시지 조회", messageError);
  if ((messageRows ?? []).length !== 0) {
    throw new Error("테스트 제출 과정에서 실제 참가자 메시지 로그가 생성됐습니다.");
  }

  const { data: invitationRows, error: invitationError } = await client
    .from("weekly_checkin_invitations")
    .select("id,status,is_test,token_hash")
    .in("id", invitationIds);
  if (invitationError) databaseFailure("production invitation 조회", invitationError);
  if ((invitationRows ?? []).length !== validationScenarios.length) {
    throw new Error("production invitation 일부가 누락됐습니다.");
  }
  for (const scenario of validationScenarios) {
    const invitation = (invitationRows ?? []).find(
      (row) => row.id === state.scenarios[scenario].invitationId,
    );
    if (!invitation || invitation.is_test !== true) {
      throw new Error(`${scenario} invitation의 테스트 표식이 올바르지 않습니다.`);
    }
    if (invitation.token_hash !== tokenHash(state.scenarios[scenario].token)) {
      throw new Error(`${scenario} token hash가 상태 파일과 일치하지 않습니다.`);
    }
    if (scenario !== "expired" && invitation.status !== "COMPLETED") {
      throw new Error(`${scenario} invitation이 COMPLETED가 아닙니다.`);
    }
  }

  const anonymousRawRowCount = await verifyAnonymousRls();
  const report: ProductionVerificationReport = {
    runTag: state.runTag,
    verifiedAt: new Date().toISOString(),
    responseIds,
    supportCaseId: String(supportCase.id),
    risks,
    issueCount: (issues ?? []).length,
    messageCount: (messageRows ?? []).length,
    anonymousRawRowCount,
  };
  state.verified = {
    verifiedAt: report.verifiedAt,
    responseIds,
    supportCaseId: report.supportCaseId,
  };
  await saveState(state);
  return report;
}

export function checkinPath(state: ProductionValidationState, scenario: ValidationScenario): string {
  return `/checkin/${encodeURIComponent(state.scenarios[scenario].token)}`;
}

export function redactValidationSecrets(
  value: string,
  state?: ProductionValidationState,
): string {
  const serverKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";
  let redacted = value;
  if (serverKey) {
    redacted = redacted.split(serverKey).join("[REDACTED_SUPABASE_SERVER_KEY]");
  }
  if (publicKey) {
    redacted = redacted.split(publicKey).join("[REDACTED_SUPABASE_PUBLIC_KEY]");
  }
  if (state) {
    for (const scenario of validationScenarios) {
      redacted = redacted.split(state.scenarios[scenario].token).join("[REDACTED_TEST_TOKEN]");
    }
    if (state.admin) {
      redacted = redacted
        .split(state.admin.password)
        .join("[REDACTED_TEST_ADMIN_PASSWORD]");
    }
    if (state.participantAccount) {
      redacted = redacted
        .split(state.participantAccount.password)
        .join("[REDACTED_TEST_PARTICIPANT_PASSWORD]");
    }
  }
  return redacted;
}

export async function assertNoServerSecretInPublicBundles(): Promise<void> {
  const config = getProductionConfiguration();
  const root = await fetch(config.productionUrl);
  const html = await root.text();
  const candidates = new Set<string>([config.serviceKey]);
  const scriptSources = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  const documents = [html];
  for (const source of scriptSources.slice(0, 50)) {
    const response = await fetch(new URL(source, config.productionUrl));
    if (response.ok) documents.push(await response.text());
  }
  for (const document of documents) {
    for (const secret of candidates) {
      if (secret.length >= 16 && document.includes(secret)) {
        throw new Error("서버 전용 Supabase 키가 공개 브라우저 자산에 포함됐습니다.");
      }
    }
  }
}

export function randomRequestId(): string {
  return randomUUID();
}
