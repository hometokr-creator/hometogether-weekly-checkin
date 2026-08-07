import { describe, expect, it, vi } from "vitest";

import { MockMessagingProvider } from "@/lib/messaging/mock-provider";
import { maskPhone, renderWeeklyCheckinMessage } from "@/lib/messaging/provider";

const input = {
  recipientId: "participant-1",
  phone: "010-1234-5678",
  name: "정인",
  counterpartLabel: "학생분",
  period: "7월 27일~8월 2일",
  deadline: "8월 5일 자정",
  checkinUrl: "https://example.test/checkin/opaque",
  idempotencyKey: "weekly:run:participant:initial",
};

describe("messaging", () => {
  it("masks phone numbers", () => {
    expect(maskPhone(input.phone)).toBe("010-****-5678");
  });

  it("renders the approved privacy-safe template", () => {
    const body = renderWeeklyCheckinMessage(input);
    expect(body).toContain("학생분과 잘 지내고 계신가요?");
    expect(body).not.toContain(input.phone);
    expect(body).not.toMatch(/상세주소|학교명|계약금액|불편사항:/);
  });

  it("uses the mock provider without exposing the full phone", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await new MockMessagingProvider().sendWeeklyCheckin(input);

    expect(result.success).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(input.phone);
    log.mockRestore();
  });
});
