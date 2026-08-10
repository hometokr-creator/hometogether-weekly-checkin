import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/dev/checkins/reset", {
    headers: { "x-hometogether-e2e-reset": "1" },
  });
  expect(response.ok()).toBe(true);
});

async function chooseAndContinue(page: Page, label: string) {
  await page.getByRole("radio", { name: label, exact: true }).click();
  const nextButton = page.getByRole("button", { name: "다음", exact: true });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
}

test("completes the short positive check-in flow", async ({ page }) => {
  await page.goto("/checkin/demo-cleanliness-guest");

  await expect(page.getByRole("heading", { name: "공동생활은 전반적으로 어떠셨나요?" })).toBeVisible();
  await page.getByRole("radio", { name: "매우 편안하게 지내고 있어요" }).click();
  await page.getByRole("button", { name: "다음" }).click();

  await page.getByRole("radio", { name: "특별한 불편은 없었어요" }).click();
  await page.getByRole("button", { name: "다음" }).click();

  await page.getByRole("checkbox", { name: "특별한 일은 없었어요" }).click();
  await page.getByRole("button", { name: "체크인 제출하기" }).click();

  await expect(page).toHaveURL(/\/checkin\/demo-cleanliness-guest\/completed/);
  await expect(page.getByRole("heading", { name: "응답이 안전하게 제출됐습니다." })).toBeVisible();
  await expect(page.getByText("상대방에게 자동으로 전달되지 않습니다.")).toBeVisible();
});

test("supports keyboard selection without horizontal overflow at 390x844", async ({ page }) => {
  await page.goto("/checkin/demo-care-pressure-guest");
  const firstChoice = page.getByRole("radio", { name: "매우 편안하게 지내고 있어요" });
  await expect(firstChoice).toBeVisible();

  // Next dev adds a development-toolbar button ahead of application content.
  // Tab through it instead of programmatically focusing the survey control.
  for (let index = 0; index < 10; index += 1) {
    if (await firstChoice.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(firstChoice).toBeFocused();
  await page.keyboard.press("Space");
  await expect(firstChoice).toHaveAttribute("aria-checked", "true");

  const nextButton = page.getByRole("button", { name: "다음" });
  for (let index = 0; index < 10; index += 1) {
    if (await nextButton.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(nextButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "이번 주에 불편한 점이 있었나요?" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const interactive = [...document.querySelectorAll<HTMLElement>(".choice-card, .primary-button")];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      controls: interactive.map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, height: box.height };
      }),
    };
  });

  expect(layout.viewportWidth).toBe(390);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  for (const control of layout.controls) {
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
});

test("submits a cleanliness issue and shows its YELLOW risk to an admin", async ({ page }) => {
  await page.goto("/checkin/demo-cleanliness-guest");

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

  await page.goto("/admin/checkins");
  // The dashboard masks participant names for every admin, so cards are located
  // by match id and the raw name must stay absent.
  const responseCard = page
    .locator("article")
    .filter({ hasText: "demo-match-3" })
    .filter({ hasText: "YELLOW" });
  await expect(responseCard).toBeVisible();
  await expect(responseCard).toContainText("청소·위생");
  await expect(page.getByText("학생 3", { exact: true })).toHaveCount(0);
});

test("submits a care-pressure issue and shows its ORANGE risk to an admin", async ({ page }) => {
  await page.goto("/checkin/demo-care-pressure-guest");

  await chooseAndContinue(page, "많이 불편해요");
  await chooseAndContinue(page, "같은 문제가 반복되고 있어요");
  await chooseAndContinue(page, "생활지원·돌봄 요청 부담");
  await chooseAndContinue(page, "거절한 뒤에도 같은 요청이 반복됨");
  await chooseAndContinue(page, "계속 이어지고 있어요");
  await chooseAndContinue(page, "현재 생활에 큰 지장을 주고 있어요");
  await chooseAndContinue(page, "직접 이야기하기 어려운 문제예요");
  await chooseAndContinue(page, "운영팀과 전화로 상담하고 싶어요");
  await chooseAndContinue(page, "추가로 불편한 점은 없어요");
  await chooseAndContinue(page, "저에게 먼저 연락한 뒤 전달 여부를 정하고 싶어요");
  await chooseAndContinue(page, "전화");

  await page.getByRole("radio", { name: "평일 오후 3시~6시", exact: true }).click();
  await page.getByRole("button", { name: "체크인 제출하기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "응답이 안전하게 제출됐습니다." })).toBeVisible();

  await page.goto("/admin/checkins");
  const responseCard = page
    .locator("article")
    .filter({ hasText: "demo-match-4" })
    .filter({ hasText: "ORANGE" });
  await expect(responseCard).toBeVisible();
  await expect(responseCard).toContainText("생활지원·돌봄 요청 부담");
  await expect(page.getByText("학생 4", { exact: true })).toHaveCount(0);
});

test("creates and prioritizes an unacknowledged RED safety case", async ({ page }) => {
  await page.goto("/checkin/demo-safety-guest");

  await page.getByRole("radio", { name: "지금 도움이 필요해요", exact: true }).click();
  await expect(page.getByRole("heading", { name: "현재 즉시 위험한 상황인가요?" })).toBeVisible();
  await chooseAndContinue(page, "네, 현재 즉시 위험해요");
  await chooseAndContinue(page, "지금은 연락받는 것이 안전하지 않아요");

  await page.getByRole("radio", { name: "아니요, 안전한 공간에 있지 않아요", exact: true }).click();
  await page.getByRole("button", { name: "체크인 제출하기", exact: true }).click();
  await expect(page).toHaveURL(/\/completed\?safety=1/);
  await expect(page.getByText("긴급한 상황에서는 설문 응답만 기다리지 말고")).toBeVisible();

  await page.goto("/admin/checkins");
  await expect(page.getByRole("link", { name: /확인하지 않은 긴급 응답이 있습니다/ })).toBeVisible();
  const responseCard = page
    .locator("article")
    .filter({ hasText: "demo-match-5" })
    .filter({ hasText: "RED" });
  await expect(responseCard).toBeVisible();
  await expect(responseCard).toContainText("안전 확인 응답");
  await expect(responseCard).toContainText("미확인");
  await expect(page.getByText("학생 5", { exact: true })).toHaveCount(0);
});
