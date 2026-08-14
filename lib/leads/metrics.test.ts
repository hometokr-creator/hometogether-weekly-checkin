import { afterEach, describe, expect, it } from "vitest";

import {
  createPublicLeadToken,
  verifyPublicLeadToken,
} from "@/lib/leads/public-token";
import {
  MemoryLeadRepository,
  buildLeadAnalytics,
} from "@/lib/leads/repository";
import {
  confirmationToViewingMinutes,
  firstResponseMinutes,
  inquiryToViewingRequestMinutes,
  leadSlaStatus,
  totalLeadToRegistrationHours,
  viewingRequestToConfirmationMinutes,
} from "@/lib/leads/metrics";
import type { LeadRecord } from "@/lib/leads/types";

const originalLeadTokenSecret = process.env.LEAD_PUBLIC_TOKEN_SECRET;

function lead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    alternativeListingUsed: false,
    createdAt: "2026-08-14T00:00:00.000Z",
    customerTags: [],
    customerType: "GUEST",
    id: "00000000-0000-4000-8000-000000000001",
    listingEvents: [],
    mustHave: [],
    outcome: { outcome: "ONGOING" },
    source: "KAKAO",
    status: "NEW",
    utm: {},
    viewingEvents: [],
    ...overrides,
  };
}

afterEach(() => {
  if (originalLeadTokenSecret === undefined)
    delete process.env.LEAD_PUBLIC_TOKEN_SECRET;
  else process.env.LEAD_PUBLIC_TOKEN_SECRET = originalLeadTokenSecret;
});

describe("lead funnel metrics", () => {
  it("calculates response and viewing milestones from event timestamps", () => {
    const record = lead({
      firstResponseAt: "2026-08-14T00:08:00.000Z",
      outcome: { outcome: "REGISTERED", closedAt: "2026-08-14T04:00:00.000Z" },
      status: "REGISTERED",
      viewingEvents: [
        {
          confirmedAt: "2026-08-14T00:30:00.000Z",
          id: "viewing-1",
          listingId: "00000000-0000-4000-8000-000000000002",
          requestedAt: "2026-08-14T00:20:00.000Z",
          viewingAt: "2026-08-14T02:00:00.000Z",
        },
      ],
    });

    expect(firstResponseMinutes(record)).toBe(8);
    expect(inquiryToViewingRequestMinutes(record)).toBe(20);
    expect(viewingRequestToConfirmationMinutes(record)).toBe(10);
    expect(confirmationToViewingMinutes(record)).toBe(90);
    expect(totalLeadToRegistrationHours(record)).toBe(4);
  });

  it("keeps the SLA active until a real first response, even after a viewing request", () => {
    const record = lead({ status: "VIEWING_REQUESTED" });

    expect(leadSlaStatus(record, new Date("2026-08-14T00:07:00.000Z"))).toBe(
      "WARNING",
    );
    expect(leadSlaStatus(record, new Date("2026-08-14T00:10:00.000Z"))).toBe(
      "BREACHED",
    );
    expect(leadSlaStatus(record, new Date("2026-08-14T00:15:00.000Z"))).toBe(
      "ESCALATED",
    );
    expect(
      leadSlaStatus(lead({ firstResponseAt: "2026-08-14T00:01:00.000Z" })),
    ).toBe("RESPONDED");
  });

  it("builds the funnel, churn, SLA, alternate-listing, term, and unmet-demand metrics", () => {
    const records = [
      lead({
        desiredRegion: "성북구",
        desiredTermMonths: 3,
        firstResponseAt: "2026-08-14T00:05:00.000Z",
        listingEvents: [
          {
            id: "click-1",
            listingId: "listing-1",
            eventType: "CLICK",
            occurredAt: "2026-08-14T00:01:00.000Z",
          },
        ],
        originalListingAvailable: true,
        outcome: {
          outcome: "REGISTERED",
          closedAt: "2026-08-14T02:00:00.000Z",
        },
        status: "REGISTERED",
        viewingEvents: [
          {
            id: "viewing-1",
            listingId: "listing-1",
            requestedAt: "2026-08-14T00:10:00.000Z",
            confirmedAt: "2026-08-14T00:20:00.000Z",
            viewingAt: "2026-08-14T01:00:00.000Z",
          },
        ],
      }),
      lead({
        alternativeListingUsed: true,
        desiredRegion: "성북구",
        desiredTermMonths: 6,
        firstResponseAt: "2026-08-14T00:15:00.000Z",
        id: "00000000-0000-4000-8000-000000000003",
        originalListingAvailable: false,
        outcome: {
          outcome: "CHURNED",
          churnReason: "NO_INVENTORY",
          churnStage: "INQUIRY",
          closedAt: "2026-08-14T01:00:00.000Z",
        },
        status: "CHURNED",
      }),
    ];

    const analytics = buildLeadAnalytics(records);

    expect(analytics.funnel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "문의", count: 2 }),
        expect.objectContaining({ stage: "등록", count: 1 }),
      ]),
    );
    expect(analytics.churnReasons).toEqual([
      { reason: "NO_INVENTORY", count: 1, rate: 50 },
    ]);
    expect(analytics.sla).toMatchObject({
      averageFirstResponseMinutes: 10,
      medianFirstResponseMinutes: 10,
    });
    expect(analytics.listingComparison).toEqual({
      originalAvailableRegistrationRate: 100,
      alternativeRegistrationRate: 0,
    });
    expect(analytics.unmetDemand).toEqual([{ region: "성북구", count: 1 }]);
  });
});

describe("lead operations", () => {
  it("persists a public lead lifecycle and all calculated milestones in development storage", async () => {
    const repository = new MemoryLeadRepository();
    const created = await repository.createLead({
      customerTags: ["UNIVERSITY_STUDENT"],
      desiredRegion: "마포구",
      originalListingId: "00000000-0000-4000-8000-000000000002",
      source: "KAKAO",
      utm: { campaign: "august" },
    });

    await repository.recordListingEvent(
      created.id,
      created.originalListingId!,
      "CLICK",
    );
    await repository.updateLead(created.id, "admin-1", { action: "RESPOND" });
    await repository.requestViewing(created.id, created.originalListingId!);
    const requested = await repository.getLead(created.id);
    const viewingEventId = requested!.viewingEvents[0]!.id;
    await repository.updateLead(created.id, "admin-1", {
      action: "CONFIRM_VIEWING",
      viewingEventId,
    });
    await repository.updateLead(created.id, "admin-1", {
      action: "COMPLETE_VIEWING",
      viewingEventId,
    });
    const registered = await repository.updateLead(created.id, "admin-1", {
      action: "REGISTER",
    });

    expect(registered).toMatchObject({
      customerTags: ["UNIVERSITY_STUDENT"],
      desiredRegion: "마포구",
      outcome: { outcome: "REGISTERED" },
      status: "REGISTERED",
      utm: { campaign: "august" },
    });
    expect(registered?.listingEvents.map((event) => event.eventType)).toEqual([
      "INQUIRY",
      "CLICK",
    ]);
  });

  it("only accepts a signed, unexpired public lead token for the matching lead", () => {
    process.env.LEAD_PUBLIC_TOKEN_SECRET =
      "a-secure-test-secret-with-at-least-thirty-two-characters";
    const now = Date.parse("2026-08-14T00:00:00.000Z");
    const token = createPublicLeadToken(
      "00000000-0000-4000-8000-000000000001",
      now,
    );

    expect(
      verifyPublicLeadToken(token, "00000000-0000-4000-8000-000000000001", now),
    ).toBe(true);
    expect(
      verifyPublicLeadToken(token, "00000000-0000-4000-8000-000000000002", now),
    ).toBe(false);
    expect(
      verifyPublicLeadToken(
        token,
        "00000000-0000-4000-8000-000000000001",
        now + 31 * 24 * 60 * 60 * 1_000,
      ),
    ).toBe(false);
  });
});
