import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateRisk } from "@/lib/checkin/calculate-risk";
import {
  getMemoryRepositoryTestSnapshot,
  MemoryCheckinRepository,
  resetMemoryRepositoryForTests,
} from "@/lib/checkin/memory-repository";
import { getPublicCheckin, submitCheckin } from "@/lib/checkin/service";
import { QUESTIONNAIRE_VERSION, type CheckinSubmission } from "@/lib/checkin/types";
import { createWeeklyCheckins } from "@/lib/jobs/create-weekly-checkins";
import { dispatchMessageOutbox } from "@/lib/jobs/dispatch-message-outbox";
import type { MessagingProvider } from "@/lib/messaging/provider";

function positiveSubmission(): CheckinSubmission {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "VERY_GOOD",
    issueStatus: "NO_ISSUE",
    positivePoints: ["NO_SPECIAL_EVENT"],
    issues: [],
    questionSnapshot: { version: QUESTIONNAIRE_VERSION },
  };
}

function cleanlinessSubmission(): CheckinSubmission {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "SLIGHTLY_UNCOMFORTABLE",
    issueStatus: "UNRESOLVED",
    positivePoints: [],
    issues: [
      {
        category: "CLEANLINESS",
        subcategory: "BATHROOM_CLEANING",
        frequency: "TWO_OR_THREE",
        severity: 3,
        discussionStatus: "NOT_DISCLOSED",
        desiredAction: "RECORD_ONLY",
      },
    ],
    disclosurePreference: "OPS_ONLY",
    contactMethod: "NO_CONTACT",
    questionSnapshot: { version: QUESTIONNAIRE_VERSION },
  };
}

function carePressureSubmission(): CheckinSubmission {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "VERY_UNCOMFORTABLE",
    issueStatus: "REPEATED",
    positivePoints: [],
    issues: [
      {
        category: "CARE_PRESSURE",
        subcategory: "REPEATED_AFTER_REFUSAL",
        frequency: "SEVERAL_TIMES",
        severity: 4,
        discussionStatus: "DISCUSSED_UNRESOLVED",
        desiredAction: "PHONE_CONSULT",
      },
    ],
    disclosurePreference: "CONTACT_BEFORE_SHARE",
    contactMethod: "PHONE",
    contactWindow: "WEEKDAY_15_18",
    questionSnapshot: { version: QUESTIONNAIRE_VERSION },
  };
}

function safetySubmission(): CheckinSubmission {
  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    overallStatus: "NEED_HELP_NOW",
    issueStatus: "UNRESOLVED",
    positivePoints: [],
    issues: [
      {
        category: "SAFETY",
        subcategory: "PHYSICAL_THREAT_VIOLENCE",
        frequency: "ONGOING",
        severity: 5,
        discussionStatus: "DIFFICULT_TO_DISCUSS",
        desiredAction: "URGENT_CONTACT",
      },
    ],
    disclosurePreference: "DO_NOT_SHARE",
    contactMethod: "NO_CONTACT",
    safety: {
      immediateDanger: "IMMEDIATE_DANGER",
      safeToContact: "NOT_SAFE_TO_CONTACT_NOW",
      safeLocation: "NO",
    },
    questionSnapshot: { version: QUESTIONNAIRE_VERSION },
  };
}

beforeEach(() => {
  resetMemoryRepositoryForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("weekly check-in response integration", () => {
  it("stores the positive path as GREEN", async () => {
    const result = await submitCheckin("demo-normal-host", positiveSubmission());
    const stored = getMemoryRepositoryTestSnapshot().responses.find(
      (response) => response.id === result.responseId,
    );

    expect(result).toMatchObject({ alreadyCompleted: false, safetyNotice: false });
    expect(stored).toMatchObject({ riskLevel: "GREEN", riskReasons: ["NO_ISSUE"] });
  });

  it("stores a cleanliness severity-3 response as YELLOW", async () => {
    const result = await submitCheckin("demo-cleanliness-guest", cleanlinessSubmission());
    const stored = getMemoryRepositoryTestSnapshot().responses.find(
      (response) => response.id === result.responseId,
    );

    expect(stored?.riskLevel).toBe("YELLOW");
    expect(stored?.riskReasons).toContain("SEVERITY_3");
  });

  it("stores repeated care pressure severity 4 as ORANGE", async () => {
    const result = await submitCheckin("demo-care-pressure-guest", carePressureSubmission());
    const stored = getMemoryRepositoryTestSnapshot().responses.find(
      (response) => response.id === result.responseId,
    );

    expect(stored?.riskLevel).toBe("ORANGE");
    expect(stored?.riskReasons).toContain("REPEATED_CARE_PRESSURE");
  });

  it("creates one unacknowledged RED case without messaging the counterpart", async () => {
    const before = getMemoryRepositoryTestSnapshot();
    const result = await submitCheckin("demo-safety-guest", safetySubmission());
    const after = getMemoryRepositoryTestSnapshot();
    const response = after.responses.find((item) => item.id === result.responseId);
    const supportCase = after.supportCases.find((item) => item.responseId === result.responseId);

    expect(result).toMatchObject({ safetyNotice: true, supportCaseCreated: true });
    expect(response?.riskLevel).toBe("RED");
    expect(supportCase).toMatchObject({ priority: "RED", status: "UNACKNOWLEDGED" });
    expect(after.messageLogs).toHaveLength(before.messageLogs.length);
  });

  it("returns a natural 410-style error for an expired link", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2100-01-01T00:00:00.000Z"));

    await expect(getPublicCheckin("demo-normal-host")).rejects.toMatchObject({
      code: "EXPIRED",
      status: 410,
      userMessage: expect.stringContaining("응답 기한이 지났습니다"),
    });
  });

  it("makes concurrent duplicate submissions idempotent", async () => {
    const [first, second] = await Promise.all([
      submitCheckin("demo-normal-host", positiveSubmission()),
      submitCheckin("demo-normal-host", positiveSubmission()),
    ]);
    const snapshot = getMemoryRepositoryTestSnapshot();

    expect(first.responseId).toBe(second.responseId);
    expect([first, second].filter((item) => item.alreadyCompleted)).toHaveLength(1);
    expect(snapshot.responses.filter((item) => item.id === first.responseId)).toHaveLength(1);
  });
});

describe("weekly delivery jobs", () => {
  it("does not duplicate invitations or messages when the cron runs concurrently", async () => {
    const repository = new MemoryCheckinRepository();
    const sendWeeklyCheckin = vi.fn(async () => ({
      success: true,
      providerMessageId: `test-${sendWeeklyCheckin.mock.calls.length}`,
    }));
    const provider: MessagingProvider = {
      sendWeeklyCheckin,
      getStatus: vi.fn(async () => ({ success: false, status: "UNKNOWN" as const })),
      verifyCallback: vi.fn(async () => ({ valid: true })),
    };
    const now = new Date("2026-08-09T09:00:00.000Z");

    const summaries = await Promise.all([
      createWeeklyCheckins({ repository, now }),
      createWeeklyCheckins({ repository, now }),
    ]);
    const third = await createWeeklyCheckins({
      repository,
      now,
    });

    expect(summaries.map((summary) => summary.created).sort((a, b) => a - b)).toEqual([0, 12]);
    expect(third.created).toBe(0);
    expect(sendWeeklyCheckin).not.toHaveBeenCalled();
    const dispatched = await dispatchMessageOutbox({ repository, provider, limit: 25 });
    expect(dispatched).toMatchObject({ claimed: 12, sent: 12, failed: 0 });
    expect(sendWeeklyCheckin).toHaveBeenCalledTimes(12);
    expect(getMemoryRepositoryTestSnapshot().messageLogs).toHaveLength(12);
  });

  it("excludes a completed invitation from reminders", async () => {
    const result = await submitCheckin("demo-normal-guest", positiveSubmission());
    const snapshot = getMemoryRepositoryTestSnapshot();
    const completed = snapshot.responses.find((item) => item.id === result.responseId);
    const repository = new MemoryCheckinRepository();

    const candidates = await repository.createReminderCandidates(
      new Date("2026-08-04T09:00:00.000Z"),
    );

    expect(completed).toBeDefined();
    expect(candidates.some((item) => item.invitation?.id === completed?.invitationId)).toBe(false);
  });
});

describe("paired responses and admin handling", () => {
  it("flags both participants when GREEN and RED responses mismatch", async () => {
    const repository = new MemoryCheckinRepository();
    const candidates = await repository.createWeeklyInvitations(
      new Date("2026-08-09T09:00:00.000Z"),
    );
    const guest = candidates.find(
      (candidate) => candidate.invitation?.matchId === "demo-match-6" && candidate.invitation.role === "GUEST",
    );
    const host = candidates.find(
      (candidate) => candidate.invitation?.matchId === "demo-match-6" && candidate.invitation.role === "HOST",
    );

    expect(guest).toBeDefined();
    expect(host).toBeDefined();
    if (!guest?.invitation || !host?.invitation) throw new Error("Missing mismatch candidates");

    const red = safetySubmission();
    const redRisk = calculateRisk(red, await repository.getRiskHistory(guest.invitation.tokenHash));
    const redResult = await repository.submit(guest.invitation.tokenHash, red, redRisk);

    const green = positiveSubmission();
    const greenRisk = calculateRisk(
      green,
      await repository.getRiskHistory(host.invitation.tokenHash),
    );
    const hostResult = await repository.submit(host.invitation.tokenHash, green, greenRisk);
    const dashboard = await repository.getDashboard();
    const guestRow = dashboard.responses.find((item) => item.id === redResult.response.id);
    const hostRow = dashboard.responses.find((item) => item.id === hostResult.response.id);

    expect(greenRisk).toMatchObject({ riskLevel: "YELLOW", pairedMismatch: true });
    expect(guestRow?.pairedMismatch).toBe(true);
    expect(hostRow?.pairedMismatch).toBe(true);
  });

  it("orders unacknowledged RED first and records acknowledgement", async () => {
    await submitCheckin("demo-normal-host", positiveSubmission());
    const repository = new MemoryCheckinRepository();
    const before = await repository.getDashboard();

    expect(before.responses[0]).toMatchObject({
      id: "demo-response-red",
      riskLevel: "RED",
      supportCase: { status: "UNACKNOWLEDGED" },
    });

    const acknowledged = await repository.updateSupportCase("demo-case-red", "admin-test", {
      action: "ACKNOWLEDGE",
    });

    expect(acknowledged).toMatchObject({ status: "OPEN" });
    expect(acknowledged?.acknowledgementAt).toEqual(expect.any(String));
  });
});
