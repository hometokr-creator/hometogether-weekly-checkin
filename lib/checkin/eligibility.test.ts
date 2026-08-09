import { describe, expect, it } from "vitest";

import {
  evaluateWeeklyEligibility,
  type EligibilityMatch,
} from "@/lib/checkin/eligibility";

function match(overrides: Partial<EligibilityMatch> = {}): EligibilityMatch {
  return {
    id: "match-1",
    status: "ACTIVE",
    moveInDate: "2026-01-01",
    moveOutDate: null,
    contractEndDate: "2026-12-31",
    homeActive: true,
    host: {
      id: "host-1",
      active: true,
      notificationEnabled: true,
      phone: "+821012345678",
    },
    guest: {
      id: "guest-1",
      active: true,
      notificationEnabled: true,
      phone: "+821087654321",
    },
    ...overrides,
  };
}

describe("weekly operational eligibility", () => {
  it("includes both sides of one current active match", () => {
    const result = evaluateWeeklyEligibility({ matches: [match()], asOfDate: "2026-08-07" });
    expect(result.eligible).toEqual([
      { matchId: "match-1", participantId: "host-1", role: "HOST" },
      { matchId: "match-1", participantId: "guest-1", role: "GUEST" },
    ]);
  });

  it.each([
    [{ status: "MOVE_OUT_SCHEDULED" }, "MATCH_NOT_ACTIVE"],
    [{ moveInDate: "2026-08-08" }, "CONTRACT_NOT_STARTED"],
    [{ contractEndDate: "2026-08-06" }, "CONTRACT_ENDED"],
    [{ homeActive: false }, "HOME_INACTIVE"],
  ] as const)("excludes invalid match state %#", (overrides, expectedCode) => {
    const result = evaluateWeeklyEligibility({ matches: [match(overrides)], asOfDate: "2026-08-07" });
    expect(result.eligible).toHaveLength(0);
    expect(new Set(result.excluded.map((item) => item.code))).toEqual(new Set([expectedCode]));
  });

  it.each([
    [{ active: false }, "PROFILE_INACTIVE"],
    [{ notificationEnabled: false }, "NOTIFICATION_DISABLED"],
    [{ phone: null }, "PHONE_INVALID"],
    [{ phone: "+82212345678" }, "PHONE_INVALID"],
  ] as const)("excludes an ineligible participant %#", (profileOverride, expectedCode) => {
    const candidate = match({ host: { ...match().host, ...profileOverride } });
    const result = evaluateWeeklyEligibility({ matches: [candidate], asOfDate: "2026-08-07" });
    expect(result.eligible.map((item) => item.participantId)).toEqual(["guest-1"]);
    expect(result.excluded.find((item) => item.participantId === "host-1")?.code).toBe(expectedCode);
  });

  it("excludes participants already invited this week", () => {
    const result = evaluateWeeklyEligibility({
      matches: [match()],
      asOfDate: "2026-08-07",
      alreadyCreatedParticipantIds: new Set(["host-1"]),
    });
    expect(result.eligible.map((item) => item.participantId)).toEqual(["guest-1"]);
    expect(result.excluded[0].code).toBe("ALREADY_CREATED");
  });

  it("does not choose an arbitrary match when one participant has multiple active matches", () => {
    const second = match({
      id: "match-2",
      guest: { ...match().guest, id: "guest-2", phone: "+821011112222" },
    });
    const result = evaluateWeeklyEligibility({ matches: [match(), second], asOfDate: "2026-08-07" });
    expect(result.eligible.map((item) => item.participantId)).toEqual(["guest-1", "guest-2"]);
    expect(
      result.excluded.filter((item) => item.participantId === "host-1").map((item) => item.code),
    ).toEqual(["MULTIPLE_ACTIVE_MATCHES", "MULTIPLE_ACTIVE_MATCHES"]);
  });
});
