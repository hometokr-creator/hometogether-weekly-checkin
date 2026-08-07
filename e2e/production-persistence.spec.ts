import { expect, test } from "@playwright/test";

import {
  checkinPath,
  cleanupProductionValidation,
  readValidationState,
  verifyProductionData,
} from "@/scripts/production-validation/lib";

test.skip(
  process.env.PRODUCTION_E2E !== "1" || process.env.PRODUCTION_PERSISTENCE_E2E !== "1",
  "Persistence verification only runs explicitly after a new Production Deployment.",
);
test.describe.configure({ mode: "serial" });

test("responses remain in the remote database and authenticated admin UI after redeploy", async ({
  browser,
}) => {
  const state = await readValidationState();
  const report = await verifyProductionData();
  expect(Object.keys(report.responseIds)).toHaveLength(4);
  expect(report.supportCaseId).toBeTruthy();

  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const participantPage = await participantContext.newPage();
  try {
    await participantPage.goto(checkinPath(state, "normal"));
  } catch {
    throw new Error("재배포 후 완료된 Production 체크인 화면을 열지 못했습니다.");
  }
  await expect(
    participantPage.getByRole("heading", { name: "응답이 안전하게 제출됐습니다." }),
  ).toBeVisible();
  await participantContext.close();

  if (!state.admin) throw new Error("테스트 관리자 상태가 없습니다.");
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/admin/login?next=%2Fadmin%2Fcheckins%3FincludeTest%3Dtrue");
  await adminPage.getByLabel("이메일").fill(state.admin.email);
  await adminPage.getByLabel("비밀번호").fill(state.admin.password);
  await adminPage.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(adminPage).toHaveURL(/\/admin\/checkins/);
  await adminPage.goto("/admin/checkins?includeTest=true");
  await expect(
    adminPage.getByText(state.scenarios.normal.participantName, { exact: true }),
  ).toBeVisible();
  await expect(
    adminPage.getByText(state.scenarios.safety.participantName, { exact: true }),
  ).toBeVisible();
  await adminContext.close();
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
