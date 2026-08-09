import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";

import { QUESTIONNAIRE_VERSION } from "@/lib/checkin/types";
import {
  assertNoServerSecretInPublicBundles,
  assertRedValidationIsSafe,
  checkinPath,
  cleanupProductionValidation,
  randomRequestId,
  seedProductionValidation,
  type ProductionValidationState,
  verifyOrdinaryParticipantBoundaries,
  verifyProductionData,
} from "@/scripts/production-validation/lib";

test.skip(
  process.env.PRODUCTION_E2E !== "1",
  "Production E2E is opt-in and never runs against the local test server.",
);
test.describe.configure({ mode: "serial" });

let state: ProductionValidationState;

test.beforeAll(async () => {
  assertRedValidationIsSafe();
  state = await seedProductionValidation();
});

test.afterAll(async () => {
  if (process.env.PRODUCTION_VALIDATION_KEEP_DATA !== "true") {
    try {
      await cleanupProductionValidation();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("검증 상태 파일이 없습니다")
      ) {
        throw error;
      }
    }
  }
});

async function chooseAndContinue(page: Page, label: string): Promise<void> {
  await page.getByRole("radio", { name: label, exact: true }).click();
  const next = page.getByRole("button", { name: "다음", exact: true });
  await expect(next).toBeEnabled();
  await next.click();
}

async function openCheckin(
  page: Page,
  scenario: "normal" | "cleanliness" | "safety" | "expired",
): Promise<void> {
  try {
    await page.goto(checkinPath(state, scenario));
  } catch {
    // Do not let Playwright print the opaque invitation URL on transport errors.
    throw new Error(`${scenario} Production 체크인 화면을 열지 못했습니다.`);
  }
}

function positiveSubmission(): Record<string, unknown> {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "VERY_GOOD",
    issueStatus: "NO_ISSUE",
    positivePoints: ["NO_SPECIAL_EVENT"],
    issues: [],
    questionSnapshot: { version: QUESTIONNAIRE_VERSION, source: "production-e2e" },
    // This untrusted field must be discarded. The stored risk must remain GREEN.
    riskLevel: "RED",
  };
}

async function submitJson(
  request: APIRequestContext,
  scenario: "duplicate",
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: APIResponse;
  try {
    response = await request.post(
      `/api/checkins/${encodeURIComponent(state.scenarios[scenario].token)}/submit`,
      {
      data: positiveSubmission(),
      headers: { "x-request-id": randomRequestId() },
      },
    );
  } catch {
    throw new Error(`${scenario} Production 제출 API에 연결하지 못했습니다.`);
  }
  return {
    status: response.status(),
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("public security boundaries reject admin, forged, IDOR, expired and unauthenticated cron access", async ({
  page,
  request,
}) => {
  await page.goto("/admin/checkins?includeTest=true");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByText(state.scenarios.normal.participantName)).toHaveCount(0);

  const adminApi = await request.get("/api/admin/support-cases");
  expect(adminApi.status()).toBe(401);

  const ordinaryBoundary = await verifyOrdinaryParticipantBoundaries();
  expect(ordinaryBoundary).toMatchObject({ visibleRawRows: 0, isAdmin: false });
  expect([401, 403]).toContain(ordinaryBoundary.adminApiStatus);

  if (!state.participantAccount) throw new Error("일반 참가자 테스트 계정이 없습니다.");
  await page.goto("/admin/login");
  await page.getByLabel("이메일").fill(state.participantAccount.email);
  await page.getByLabel("비밀번호").fill(state.participantAccount.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByText("이 계정에는 홈투게더 관리자 권한이 없습니다.", {
      exact: true,
    }),
  ).toBeVisible();

  const cron = await request.get("/api/cron/weekly-checkins");
  expect(cron.status()).toBe(401);

  const normalToken = state.scenarios.normal.token;
  const forgedToken = `${normalToken[0] === "A" ? "B" : "A"}${normalToken.slice(1)}`;
  let forged: APIResponse;
  try {
    forged = await request.get(`/api/checkins/${encodeURIComponent(forgedToken)}`);
  } catch {
    throw new Error("위조 token Production API에 연결하지 못했습니다.");
  }
  expect(forged.status()).toBe(404);

  const idor = await request.get(
    `/api/checkins/${encodeURIComponent(state.scenarios.normal.invitationId)}`,
  );
  expect(idor.status()).toBe(404);

  let expiredSubmit: APIResponse;
  try {
    expiredSubmit = await request.post(
      `/api/checkins/${encodeURIComponent(state.scenarios.expired.token)}/submit`,
      { data: positiveSubmission() },
    );
  } catch {
    throw new Error("expired Production 제출 API에 연결하지 못했습니다.");
  }
  expect(expiredSubmit.status()).toBe(410);

  await openCheckin(page, "expired");
  await expect(page.locator("main[role='alert']")).toContainText(
    "응답 기한이 지났습니다",
  );

  await assertNoServerSecretInPublicBundles();
});

test("scenario A submits a normal response from the 390px public UI", async ({ page }) => {
  await openCheckin(page, "normal");
  await expect(page.getByRole("heading", { name: "공동생활은 전반적으로 어떠셨나요?" })).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    controls: [...document.querySelectorAll<HTMLElement>(".choice-card, .primary-button")].map(
      (element) => element.getBoundingClientRect().height,
    ),
  }));
  expect(layout.viewportWidth).toBe(390);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  for (const height of layout.controls) expect(height).toBeGreaterThanOrEqual(44);

  await chooseAndContinue(page, "대체로 괜찮아요");
  await chooseAndContinue(page, "특별한 불편은 없었어요");
  await page.getByRole("checkbox", { name: "대화와 소통이 원활했어요", exact: true }).click();
  await page.getByRole("button", { name: "체크인 제출하기", exact: true }).click();

  await expect(page.getByRole("heading", { name: "응답이 안전하게 제출됐습니다." })).toBeVisible();
  await expect(page.getByText("상대방에게 자동으로 전달되지 않습니다.")).toBeVisible();
});

test("scenario B stores a bathroom-cleanliness issue", async ({ page }) => {
  await openCheckin(page, "cleanliness");
  await chooseAndContinue(page, "조금 불편한 점이 있어요");
  await chooseAndContinue(page, "아직 해결되지 않은 불편이 있어요");
  await chooseAndContinue(page, "청소·위생");
  await chooseAndContinue(page, "욕실 청소");
  await chooseAndContinue(page, "두세 번 있었어요");
  await chooseAndContinue(page, "꽤 불편하고, 반복되면 계속 지내기 어려울 것 같아요");
  await chooseAndContinue(page, "아직 이야기하지 않았어요");
  await chooseAndContinue(page, "조치 없이 기록만 남겨주세요");
  await chooseAndContinue(page, "추가로 불편한 점은 없어요");
  await chooseAndContinue(page, "우선 홈투게더 운영팀만 확인해 주세요");
  await page.getByRole("radio", { name: "연락을 원하지 않아요", exact: true }).click();
  await page.getByRole("button", { name: "체크인 제출하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "응답이 안전하게 제출됐습니다." })).toBeVisible();
});

test("scenario C records physical threat as RED without messaging a counterpart", async ({ page }) => {
  await openCheckin(page, "safety");
  await chooseAndContinue(page, "많이 불편해요");
  await chooseAndContinue(page, "아직 해결되지 않은 불편이 있어요");
  await chooseAndContinue(page, "안전·위협");

  await expect(page.getByRole("radio", { name: "신체적 위협이나 폭력", exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "신체적 위협이나 폭력", exact: true }).click();
  await expect(page.getByRole("heading", { name: "현재 즉시 위험한 상황인가요?" })).toBeVisible();
  await chooseAndContinue(page, "네, 현재 즉시 위험해요");
  await chooseAndContinue(page, "지금은 연락받는 것이 안전하지 않아요");
  await page.getByRole("radio", { name: "아니요, 안전한 공간에 있지 않아요", exact: true }).click();
  await page.getByRole("button", { name: "체크인 제출하기", exact: true }).click();

  await expect(page.getByText("긴급한 상황에서는 설문 응답만 기다리지 말고")).toBeVisible();
});

test("duplicate submissions are idempotent and client riskLevel is ignored", async ({ request }) => {
  const [first, second] = await Promise.all([
    submitJson(request, "duplicate"),
    submitJson(request, "duplicate"),
  ]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.responseId).toBe(second.body.responseId);
  expect([first.body.alreadyCompleted, second.body.alreadyCompleted].filter(Boolean)).toHaveLength(1);
  expect(first.body.safetyNotice).toBe(false);
  expect(second.body.safetyNotice).toBe(false);
});

test("remote rows, inherited is_test, server risks, RLS and the authenticated admin UI agree", async ({
  page,
}) => {
  const report = await verifyProductionData();
  expect(report.risks).toMatchObject({
    normal: "GREEN",
    cleanliness: "YELLOW",
    safety: "RED",
    duplicate: "GREEN",
  });
  expect(report.issueCount).toBe(1);
  expect(report.messageCount).toBe(0);
  expect(report.anonymousRawRowCount).toBe(0);
  expect(report.supportCaseId).toBeTruthy();

  if (!state.admin) throw new Error("테스트 관리자 상태가 없습니다.");
  await page.goto("/admin/login?next=%2Fadmin%2Fcheckins%3FincludeTest%3Dtrue");
  await page.getByLabel("이메일").fill(state.admin.email);
  await page.getByLabel("비밀번호").fill(state.admin.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/checkins/);
  await page.goto("/admin/checkins?includeTest=true");

  await expect(page.getByText("테스트 데이터", { exact: false }).first()).toBeVisible();
  const responseIds = {
    normal: report.responseIds.normal,
    cleanliness: report.responseIds.cleanliness,
    safety: report.responseIds.safety,
  };
  for (const scenario of ["normal", "cleanliness", "safety"] as const) {
    expect(responseIds[scenario]).toBeTruthy();
    await expect(
      page.locator(`a[href="/admin/checkins/${encodeURIComponent(responseIds[scenario] ?? "missing")}"]`),
    ).toBeVisible();
    await expect(
      page.getByText(state.scenarios[scenario].participantName, { exact: true }),
    ).toHaveCount(0);
  }
  const responseCards = page.locator('article:has(a[href^="/admin/checkins/"])');
  const safetyCard = responseCards.filter({
    has: page.locator(
      `a[href="/admin/checkins/${encodeURIComponent(responseIds.safety ?? "missing")}"]`,
    ),
  });
  await expect(safetyCard).toContainText("RED");
  await expect(safetyCard).toContainText("미확인");
  const responseHrefs = await responseCards.evaluateAll((cards) =>
    cards.map((card) => card.querySelector<HTMLAnchorElement>('a[href^="/admin/checkins/"]')?.getAttribute("href")),
  );
  const safetyIndex = responseHrefs.indexOf(`/admin/checkins/${responseIds.safety}`);
  const normalIndex = responseHrefs.indexOf(`/admin/checkins/${responseIds.normal}`);
  const cleanlinessIndex = responseHrefs.indexOf(`/admin/checkins/${responseIds.cleanliness}`);
  expect(safetyIndex).toBeGreaterThanOrEqual(0);
  expect(normalIndex).toBeGreaterThanOrEqual(0);
  expect(cleanlinessIndex).toBeGreaterThanOrEqual(0);
  expect(safetyIndex).toBeLessThan(normalIndex);
  expect(safetyIndex).toBeLessThan(cleanlinessIndex);
});
