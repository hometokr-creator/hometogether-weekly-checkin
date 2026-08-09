import { randomUUID } from "node:crypto";

import {
  maskPhone,
  renderWeeklyCheckinMessage,
  type MessagingProvider,
  type MessagingResult,
  type MessagingStatusInput,
  type MessagingStatusResult,
  type MessagingCallbackInput,
  type MessagingCallbackResult,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

export class MockMessagingProvider implements MessagingProvider {
  async sendWeeklyCheckin(input: WeeklyCheckinMessageInput): Promise<MessagingResult> {
    const providerMessageId = `mock_${randomUUID()}`;
    const safePreview = {
      provider: "mock",
      providerMessageId,
      recipientMasked: maskPhone(input.phone),
      idempotencyKey: input.idempotencyKey,
      buttonName: "주간 체크인 하기",
      // Names, internal participant IDs, message text, and invitation URLs stay
      // out of production logs. Developers can still inspect the rendered mock
      // message locally where no real participant data is used.
      ...(process.env.NODE_ENV !== "production"
        ? {
            recipientId: input.recipientId,
            body: renderWeeklyCheckinMessage(input),
            checkinUrl: input.checkinUrl,
          }
        : {}),
    };

    console.info("[weekly-checkin:mock]", safePreview);
    return { success: true, providerMessageId };
  }

  async getStatus(input: MessagingStatusInput): Promise<MessagingStatusResult> {
    return {
      success: true,
      status: "DELIVERED",
      providerMessageId: input.providerMessageId ?? `mock_${input.idempotencyKey}`,
    };
  }

  async verifyCallback(input: MessagingCallbackInput): Promise<MessagingCallbackResult> {
    void input;
    return { valid: true, status: "DELIVERED" };
  }
}
