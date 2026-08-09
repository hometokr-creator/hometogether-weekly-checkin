import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  findInvitation: vi.fn(),
  getRiskHistory: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@/lib/checkin/repository-factory", () => ({
  getCheckinRepository: vi.fn(async () => repository),
}));

import { createQuestionnaireSnapshot } from "@/lib/checkin/question-tree";
import { serializeServiceError, submitCheckin } from "@/lib/checkin/service";
import { QUESTIONNAIRE_VERSION } from "@/lib/checkin/types";

beforeEach(() => {
  vi.clearAllMocks();
  repository.findInvitation.mockResolvedValue({
    id: "invitation-1",
    recipientName: "테스트 응답자",
    role: "GUEST",
    period: "이번 주",
    expiresAt: "2099-08-09T00:00:00.000Z",
    status: "SENT",
  });
  repository.getRiskHistory.mockResolvedValue({});
  repository.submit.mockImplementation(
    async (_tokenHash, submission, risk) => ({
      response: {
        id: "response-1",
        invitationId: "invitation-1",
        matchId: "match-1",
        participantId: "participant-1",
        role: "GUEST",
        submission,
        riskLevel: risk.riskLevel,
        riskReasons: risk.riskReasons,
        pairedMismatch: risk.pairedMismatch,
        submittedAt: "2026-08-09T00:00:00.000Z",
      },
      alreadyCompleted: false,
    }),
  );
});

describe("check-in service error logging", () => {
  it("does not log raw unexpected error details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "https://hometogether.test/checkin/secretBearerToken_123456789";

    expect(serializeServiceError(new Error(`delivery failed for ${secret}`))).toMatchObject({
      status: 500,
    });

    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("weekly-checkin.unexpected-service-error");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("delivery failed");
    log.mockRestore();
  });
});

describe("check-in submission audit snapshot", () => {
  it("replaces a browser-supplied snapshot with the canonical server definition", async () => {
    await submitCheckin("A".repeat(43), {
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      overallStatus: "VERY_GOOD",
      issueStatus: "NO_ISSUE",
      positivePoints: ["NO_SPECIAL_EVENT"],
      issues: [],
      questionSnapshot: {
        forged: true,
        questions: { overallStatus: { prompt: "조작된 질문" } },
      },
    });

    const storedSubmission = repository.submit.mock.calls[0]?.[1];
    expect(storedSubmission.questionSnapshot).toEqual(createQuestionnaireSnapshot());
    expect(storedSubmission.questionSnapshot).not.toHaveProperty("forged");
    expect(storedSubmission.questionSnapshot).toHaveProperty(
      "version",
      QUESTIONNAIRE_VERSION,
    );
  });
});
