import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3107);
const productionE2E = process.env.PRODUCTION_E2E === "1";
const externalBaseURL = productionE2E
  ? process.env.PRODUCTION_URL
  : process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

if (productionE2E && !externalBaseURL) {
  throw new Error("PRODUCTION_URL is required when PRODUCTION_E2E=1");
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: productionE2E
    ? "line"
    : process.env.CI
      ? [["line"], ["html", { open: "never" }]]
      : "line",
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    // Production traces can contain opaque invitation URLs and are therefore
    // disabled. Local debugging keeps the richer artifacts.
    trace: productionE2E ? "off" : "retain-on-failure",
    screenshot: productionE2E ? "off" : "only-on-failure",
    video: productionE2E ? "off" : "retain-on-failure",
  },
  projects: productionE2E
    ? [
        {
          name: "production-mobile-chromium",
          use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
        },
      ]
    : [
        {
          name: "mobile-chromium",
          testIgnore: [/production-weekly-checkin\.spec\.ts/, /production-persistence\.spec\.ts/],
          use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
        },
      ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: false,
        env: {
          ...process.env,
          ALLOW_DEV_ADMIN: "true",
          APP_BASE_URL: baseURL,
          MESSAGING_PROVIDER: "mock",
          ENABLE_CHECKIN_REMINDERS: "true",
        },
      },
});
