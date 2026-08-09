import { KakaoAlimtalkProvider } from "@/lib/messaging/kakao-alimtalk-provider";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { SmsFallbackMessagingProvider } from "@/lib/messaging/sms-fallback-provider";
import {
  getAlimtalkRuntimeConfig,
  getMessagingConfigurationStatus,
} from "@/lib/messaging/config";

export function createMessagingProvider(): MessagingProvider {
  const status = getMessagingConfigurationStatus();
  let provider: MessagingProvider;
  if (status.readyForAdminTest) {
    const config = getAlimtalkRuntimeConfig();
    provider = new KakaoAlimtalkProvider({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      senderProfile: config.senderProfile,
      templateCode: config.templateCode,
      callbackSecret: config.callbackSecret,
    });
  } else if (process.env.NODE_ENV !== "production" && status.provider === "mock") {
    provider = new MockMessagingProvider();
  } else {
    throw new Error(`ALIMTALK_CONFIGURATION_MISSING:${status.missing.join(",")}`);
  }

  const enableSms = process.env.ENABLE_SMS_FALLBACK === "true";
  if (enableSms && process.env.SMS_API_BASE_URL && process.env.SMS_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMS_FALLBACK_REQUIRES_DEDICATED_OUTBOX");
    }
    provider = new SmsFallbackMessagingProvider(provider, {
      baseUrl: process.env.SMS_API_BASE_URL,
      apiKey: process.env.SMS_API_KEY,
    });
  }

  return provider;
}

export type { MessagingProvider, WeeklyCheckinMessageInput } from "@/lib/messaging/provider";
