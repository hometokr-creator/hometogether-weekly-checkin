import { KakaoAlimtalkProvider } from "@/lib/messaging/kakao-alimtalk-provider";
import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import type { MessagingProvider } from "@/lib/messaging/provider";
import { SmsFallbackMessagingProvider } from "@/lib/messaging/sms-fallback-provider";

export function createMessagingProvider(): MessagingProvider {
  const useKakao = process.env.MESSAGING_PROVIDER === "kakao";
  const kakaoReady = Boolean(
    process.env.KAKAO_API_BASE_URL &&
      process.env.KAKAO_API_KEY &&
      process.env.KAKAO_SENDER_KEY &&
      process.env.KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE,
  );

  let provider: MessagingProvider;
  if (useKakao && kakaoReady) {
    provider = new KakaoAlimtalkProvider({
      baseUrl: process.env.KAKAO_API_BASE_URL!,
      apiKey: process.env.KAKAO_API_KEY!,
      senderKey: process.env.KAKAO_SENDER_KEY!,
      templateCode: process.env.KAKAO_WEEKLY_CHECKIN_TEMPLATE_CODE!,
    });
  } else {
    provider = new MockMessagingProvider();
  }

  const enableSms = process.env.ENABLE_SMS_FALLBACK === "true";
  if (enableSms && process.env.SMS_API_BASE_URL && process.env.SMS_API_KEY) {
    provider = new SmsFallbackMessagingProvider(provider, {
      baseUrl: process.env.SMS_API_BASE_URL,
      apiKey: process.env.SMS_API_KEY,
    });
  }

  return provider;
}

export type { MessagingProvider, WeeklyCheckinMessageInput } from "@/lib/messaging/provider";
