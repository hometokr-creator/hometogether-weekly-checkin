import { afterEach, describe, expect, it } from "vitest";

import {
  getMessagingConfigurationStatus,
  getPublicCheckinBaseUrl,
} from "@/lib/messaging/config";
import { createMessagingProvider } from "@/lib/messaging";

const managedKeys = [
  "MESSAGING_PROVIDER",
  "ALIMTALK_PROVIDER",
  "ALIMTALK_API_BASE_URL",
  "ALIMTALK_API_KEY",
  "ALIMTALK_API_SECRET",
  "ALIMTALK_SENDER_PROFILE",
  "ALIMTALK_TEMPLATE_CODE",
  "ALIMTALK_CALLBACK_SECRET",
  "KAKAO_API_BASE_URL",
  "KAKAO_API_KEY",
  "KAKAO_API_SECRET",
  "KAKAO_SENDER_KEY",
  "KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE",
  "KAKAO_CALLBACK_SECRET",
  "CHECKIN_SENDING_ENABLED",
  "PUBLIC_CHECKIN_BASE_URL",
  "TEST_ALIMTALK_CALLBACK_ROUTE_IMPLEMENTED",
] as const;

const originals = Object.fromEntries(managedKeys.map((key) => [key, process.env[key]]));
const originalNodeEnv = process.env.NODE_ENV;

function clearCanonicalConfig() {
  for (const key of managedKeys) delete process.env[key];
}

afterEach(() => {
  for (const key of managedKeys) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
});

describe("Alimtalk configuration", () => {
  it("fails closed when production credentials are missing", () => {
    clearCanonicalConfig();
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.MESSAGING_PROVIDER = "mock";

    const status = getMessagingConfigurationStatus();
    expect(status).toMatchObject({
      credentialsConfigured: false,
      sendingEnabled: false,
      readyForProduction: false,
      readyForAdminTest: false,
    });
    expect(status.missing).toContain("ALIMTALK_API_KEY");
    expect(() => createMessagingProvider()).toThrow(/ALIMTALK_CONFIGURATION_MISSING/);
  });

  it("supports legacy KAKAO aliases but blocks bulk sending without callback delivery receipts", () => {
    clearCanonicalConfig();
    process.env.MESSAGING_PROVIDER = "kakao";
    process.env.KAKAO_API_BASE_URL = "https://relay.example.test";
    process.env.KAKAO_API_KEY = "legacy-key";
    process.env.KAKAO_API_SECRET = "legacy-secret";
    process.env.KAKAO_SENDER_KEY = "legacy-sender";
    process.env.KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE = "legacy-template";
    process.env.KAKAO_CALLBACK_SECRET = "legacy-callback-secret";
    process.env.CHECKIN_SENDING_ENABLED = "true";

    const status = getMessagingConfigurationStatus();
    expect(status).toMatchObject({
      provider: "kakao",
      credentialsConfigured: true,
      senderProfileConfigured: true,
      templateConfigured: true,
      callbackConfigured: false,
      readyForAdminTest: true,
      readyForProduction: false,
    });
    expect(status.missing).toContain("ALIMTALK_CALLBACK_ROUTE_IMPLEMENTATION");
    expect(JSON.stringify(status)).not.toContain("legacy-key");
  });

  it("prefers the public check-in origin", () => {
    process.env.PUBLIC_CHECKIN_BASE_URL = "https://checkin.hometogether.kr/path";
    process.env.APP_BASE_URL = "https://fallback.example.test";
    expect(getPublicCheckinBaseUrl()).toBe("https://checkin.hometogether.kr");
  });
});
