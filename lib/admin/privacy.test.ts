import { describe, expect, it } from "vitest";

import {
  maskDisplayName,
  minimizeDashboardResponse,
} from "@/lib/admin/privacy";
import type { DashboardResponseRow } from "@/lib/checkin/types";

const response = {
  id: "response-1",
  invitationId: "invitation-1",
  matchId: "match-1",
  participantId: "participant-1",
  recipientName: "홍길동",
  period: "이번 주",
  role: "GUEST",
  submission: {
    questionnaireVersion: "2026-08-v1",
    overallStatus: "SLIGHTLY_UNCOMFORTABLE",
    positivePoints: [],
    issues: [{
      category: "COMMUNICATION",
      subcategory: "대화",
      frequency: "ONCE",
      severity: 2,
      discussionStatus: "NOT_DISCLOSED",
      desiredAction: "RECORD_ONLY",
      additionalNote: "민감한 자유 입력",
    }],
    safety: {
      immediateDanger: "NOT_IMMEDIATE",
      safeToContact: "KAKAO_ONLY",
      safeLocation: "YES",
    },
    questionSnapshot: { hidden: "raw snapshot" },
  },
  riskLevel: "YELLOW",
  riskReasons: [],
  pairedMismatch: false,
  submittedAt: "2026-08-09T00:00:00.000Z",
  isTest: false,
} satisfies DashboardResponseRow;

describe("admin privacy minimization", () => {
  it("masks participant identity and removes raw/free-text answers for CHECKIN_READ", () => {
    const minimized = minimizeDashboardResponse(response, ["CHECKIN_READ"]);
    expect(minimized.recipientName).toBe("홍**");
    expect(minimized.submission.questionSnapshot).toEqual({});
    expect(minimized.submission.issues[0]?.additionalNote).toBeUndefined();
    expect(minimized.submission.safety).toBeUndefined();
  });

  it("keeps safety content for SAFETY_READ but never returns the raw snapshot", () => {
    const minimized = minimizeDashboardResponse(response, ["SAFETY_READ"]);
    expect(minimized.submission.safety).toEqual(response.submission.safety);
    expect(minimized.submission.issues[0]?.additionalNote).toBe("민감한 자유 입력");
    expect(minimized.submission.questionSnapshot).toEqual({});
  });

  it("handles short and empty display names safely", () => {
    expect(maskDisplayName("김")).toBe("김*");
    expect(maskDisplayName("응답자")).toBe("응답자");
  });
});
