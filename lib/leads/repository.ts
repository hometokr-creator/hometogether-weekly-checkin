import "server-only";

import { randomUUID } from "node:crypto";

import { fetchAllSupabaseRows } from "@/lib/supabase/pagination";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  CreateLeadInput,
  LeadAnalytics,
  LeadChurnReason,
  LeadChurnStage,
  LeadDashboard,
  LeadFilters,
  LeadListingEvent,
  LeadListingSlot,
  LeadOutcome,
  LeadRecord,
  LeadSource,
  LeadStatus,
  LeadViewingEvent,
} from "@/lib/leads/types";
import {
  firstResponseMinutes,
  isCreatedBetween,
  isSlaCompliant,
  isViewed,
  isViewingConfirmed,
  isViewingRequested,
} from "@/lib/leads/metrics";

type JsonRow = Record<string, unknown>;

export type LeadActionInput =
  | { action: "RESPOND" }
  | { action: "ASSIGN"; assignedAdminId?: string }
  | { action: "RECOMMEND_ALTERNATIVE"; listingId: string }
  | { action: "REQUEST_VIEWING"; listingId: string; slotId?: string }
  | { action: "CONFIRM_VIEWING"; viewingEventId: string }
  | { action: "COMPLETE_VIEWING"; viewingEventId: string; viewingAt?: string }
  | {
      action: "CANCEL_VIEWING";
      viewingEventId: string;
      cancellationActor: "CUSTOMER" | "HOST" | "ADMIN" | "SYSTEM";
      cancellationReason?: string;
    }
  | {
      action: "CHURN";
      churnStage: LeadChurnStage;
      churnReason: LeadChurnReason;
      churnReasonNote?: string;
    }
  | { action: "REGISTER" };

export type CreateViewingSlotInput = {
  listingId: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  hostProfileId?: string;
};

export type ImportLeadRow = CreateLeadInput & {
  importRecordId: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
};

export interface LeadRepository {
  getDashboard(filters?: LeadFilters): Promise<LeadDashboard>;
  getLead(id: string): Promise<LeadRecord | null>;
  createLead(input: CreateLeadInput): Promise<LeadRecord>;
  recordListingEvent(
    leadId: string,
    listingId: string,
    eventType: "IMPRESSION" | "CLICK",
  ): Promise<void>;
  requestViewing(
    leadId: string,
    listingId: string,
    slotId?: string,
  ): Promise<LeadRecord | null>;
  updateLead(
    id: string,
    adminId: string,
    input: LeadActionInput,
  ): Promise<LeadRecord | null>;
  listAvailableSlots(
    listingId: string,
    from?: string,
  ): Promise<LeadListingSlot[]>;
  createViewingSlot(
    input: CreateViewingSlotInput,
    adminId: string,
  ): Promise<LeadListingSlot>;
  getAnalytics(filters?: LeadFilters): Promise<LeadAnalytics>;
  importLeads(input: {
    adminId: string;
    fileName: string;
    fileSha256: string;
    sourceSystem: string;
    rows: ImportLeadRow[];
  }): Promise<{
    batchId: string;
    importedRows: number;
    skippedRows: number;
    alreadyApplied: boolean;
  }>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function objectValue(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRow)
    : {};
}

function isLeadSource(value: unknown): value is LeadSource {
  return [
    "KAKAO",
    "EVERYTIME",
    "INSTAGRAM",
    "WEBSITE",
    "REFERRAL",
    "ETC",
  ].includes(String(value));
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return [
    "NEW",
    "CONTACTED",
    "VIEWING_REQUESTED",
    "VIEWING_CONFIRMED",
    "VIEWED",
    "REGISTERED",
    "CHURNED",
  ].includes(String(value));
}

function mapListingEvent(row: JsonRow): LeadListingEvent {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    eventType: String(row.event_type) as LeadListingEvent["eventType"],
    occurredAt: String(row.occurred_at),
  };
}

function mapViewingEvent(row: JsonRow): LeadViewingEvent {
  const cancellationActor = stringValue(row.cancellation_actor);
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    slotId: stringValue(row.slot_id),
    requestedAt: String(row.requested_at),
    confirmedAt: stringValue(row.confirmed_at),
    viewingAt: stringValue(row.viewing_at),
    cancelledAt: stringValue(row.cancelled_at),
    cancellationActor:
      cancellationActor === "CUSTOMER" ||
      cancellationActor === "HOST" ||
      cancellationActor === "ADMIN" ||
      cancellationActor === "SYSTEM"
        ? cancellationActor
        : undefined,
    cancellationReason: stringValue(row.cancellation_reason),
  };
}

function mapLead(
  row: JsonRow,
  related: {
    listingNameById: Map<string, string>;
    eventsByLead: Map<string, LeadListingEvent[]>;
    viewingsByLead: Map<string, LeadViewingEvent[]>;
    outcomeByLead: Map<string, JsonRow>;
  },
): LeadRecord {
  const id = String(row.id);
  const outcomeRow = related.outcomeByLead.get(id);
  const outcome = objectValue(outcomeRow);
  const outcomeValue = stringValue(outcome.outcome);
  const customerType = stringValue(row.customer_type);
  const source = stringValue(row.source);
  const status = stringValue(row.status);
  const utm = {
    source: stringValue(row.utm_source),
    medium: stringValue(row.utm_medium),
    campaign: stringValue(row.utm_campaign),
    term: stringValue(row.utm_term),
    content: stringValue(row.utm_content),
  };
  const originalListingId = stringValue(row.original_listing_id);

  return {
    id,
    customerProfileId: stringValue(row.customer_profile_id),
    customerLabel: stringValue(row.customer_label),
    customerType:
      customerType === "GUEST" ||
      customerType === "HOST" ||
      customerType === "GUEST_PARENT" ||
      customerType === "HOST_CHILD"
        ? customerType
        : "UNKNOWN",
    customerTags: arrayOfStrings(row.customer_tags),
    source: isLeadSource(source) ? source : "ETC",
    sourceDetail: stringValue(row.source_detail),
    utm,
    landingPath: stringValue(row.landing_path),
    desiredRegion: stringValue(row.desired_region),
    desiredMoveIn: stringValue(row.desired_move_in),
    desiredTermMonths: numberValue(row.desired_term_months),
    budgetMonthly: numberValue(row.budget_monthly),
    budgetDeposit: numberValue(row.budget_deposit),
    mustHave: arrayOfStrings(row.must_have),
    status: isLeadStatus(status) ? status : "NEW",
    originalListingId,
    originalListingName: originalListingId
      ? related.listingNameById.get(originalListingId)
      : undefined,
    originalListingAvailable:
      typeof row.original_listing_available === "boolean"
        ? row.original_listing_available
        : undefined,
    alternativeListingUsed: row.alternative_listing_used === true,
    createdAt: String(row.created_at),
    firstResponseAt: stringValue(row.first_response_at),
    lastContactAt: stringValue(row.last_contact_at),
    assignedAdminId: stringValue(row.assigned_admin_id),
    outcome: {
      outcome:
        outcomeValue === "REGISTERED" || outcomeValue === "CHURNED"
          ? outcomeValue
          : "ONGOING",
      churnStage: stringValue(outcome.churn_stage) as
        LeadChurnStage | undefined,
      churnReason: stringValue(outcome.churn_reason) as
        LeadChurnReason | undefined,
      churnReasonNote: stringValue(outcome.churn_reason_note),
      closedAt: stringValue(outcome.closed_at),
    },
    listingEvents: related.eventsByLead.get(id) ?? [],
    viewingEvents: related.viewingsByLead.get(id) ?? [],
    importConfidence: stringValue(
      row.import_confidence,
    ) as LeadRecord["importConfidence"],
  };
}

function termBucket(lead: LeadRecord): LeadFilters["term"] {
  const term = lead.desiredTermMonths;
  if (term === 1) return "ONE";
  if (term && term <= 3) return "TWO_TO_THREE";
  if (term === 4) return "FOUR";
  if (term && term <= 6) return "FIVE_TO_SIX";
  return "OVER_SIX";
}

export function filterLeads(
  leads: LeadRecord[],
  filters: LeadFilters = {},
): LeadRecord[] {
  return leads.filter((lead) => {
    if (!isCreatedBetween(lead, filters.from, filters.to)) return false;
    if (filters.source && lead.source !== filters.source) return false;
    if (filters.customerType && lead.customerType !== filters.customerType)
      return false;
    if (filters.region && lead.desiredRegion !== filters.region) return false;
    if (filters.term && termBucket(lead) !== filters.term) return false;
    if (filters.stage && lead.status !== filters.stage) return false;
    if (filters.outcome && lead.outcome.outcome !== filters.outcome)
      return false;
    if (filters.churnReason && lead.outcome.churnReason !== filters.churnReason)
      return false;
    if (
      filters.assignedAdminId &&
      lead.assignedAdminId !== filters.assignedAdminId
    )
      return false;
    return true;
  });
}

export function buildLeadAnalytics(leads: LeadRecord[]): LeadAnalytics {
  const denominator = leads.length;
  const count = (predicate: (lead: LeadRecord) => boolean) =>
    leads.filter(predicate).length;
  const funnelRaw = [
    ["문의", () => true],
    [
      "매물 클릭",
      (lead: LeadRecord) =>
        lead.listingEvents.some((event) => event.eventType === "CLICK"),
    ],
    ["방문 요청", isViewingRequested],
    ["방문 확정", isViewingConfirmed],
    ["실제 방문", isViewed],
    ["등록", (lead: LeadRecord) => lead.outcome.outcome === "REGISTERED"],
  ] as const;
  const responseTimes = leads
    .map(firstResponseMinutes)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  const median = responseTimes.length
    ? responseTimes.length % 2
      ? responseTimes[Math.floor(responseTimes.length / 2)]
      : (responseTimes[responseTimes.length / 2 - 1] +
          responseTimes[responseTimes.length / 2]) /
        2
    : undefined;
  const registrationRate = (items: LeadRecord[]) =>
    items.length
      ? Math.round(
          (countFrom(items, (lead) => lead.outcome.outcome === "REGISTERED") /
            items.length) *
            1000,
        ) / 10
      : 0;
  const compliant = leads.filter((lead) => isSlaCompliant(lead) === true);
  const late = leads.filter((lead) => {
    const value = firstResponseMinutes(lead);
    return value !== undefined && value > 10;
  });
  const termLabels: Array<[LeadFilters["term"], string]> = [
    ["ONE", "1개월"],
    ["TWO_TO_THREE", "2~3개월"],
    ["FOUR", "4개월"],
    ["FIVE_TO_SIX", "5~6개월"],
    ["OVER_SIX", "6개월 초과"],
  ];
  const churnCounts = new Map<LeadChurnReason, number>();
  for (const lead of leads) {
    if (lead.outcome.outcome === "CHURNED" && lead.outcome.churnReason) {
      churnCounts.set(
        lead.outcome.churnReason,
        (churnCounts.get(lead.outcome.churnReason) ?? 0) + 1,
      );
    }
  }
  const unmetDemand = new Map<string, number>();
  for (const lead of leads) {
    if (
      lead.desiredRegion &&
      lead.outcome.outcome === "CHURNED" &&
      ["NO_INVENTORY", "LOCATION"].includes(lead.outcome.churnReason ?? "")
    ) {
      unmetDemand.set(
        lead.desiredRegion,
        (unmetDemand.get(lead.desiredRegion) ?? 0) + 1,
      );
    }
  }

  return {
    funnel: funnelRaw.map(([stage, predicate]) => {
      const stageCount = count(predicate);
      return {
        stage,
        count: stageCount,
        conversionRate: denominator
          ? Math.round((stageCount / denominator) * 1000) / 10
          : 0,
      };
    }),
    churnReasons: [...churnCounts.entries()]
      .map(([reason, count]) => ({
        reason,
        count,
        rate: denominator ? Math.round((count / denominator) * 1000) / 10 : 0,
      }))
      .sort((left, right) => right.count - left.count),
    sla: {
      withinTenMinuteConversionRate: registrationRate(compliant),
      overTenMinuteConversionRate: registrationRate(late),
      averageFirstResponseMinutes: responseTimes.length
        ? Math.round(
            (responseTimes.reduce((sum, value) => sum + value, 0) /
              responseTimes.length) *
              10,
          ) / 10
        : undefined,
      medianFirstResponseMinutes: median,
    },
    listingComparison: {
      originalAvailableRegistrationRate: registrationRate(
        leads.filter((lead) => lead.originalListingAvailable === true),
      ),
      alternativeRegistrationRate: registrationRate(
        leads.filter(
          (lead) =>
            lead.originalListingAvailable === false &&
            lead.alternativeListingUsed,
        ),
      ),
    },
    termBuckets: termLabels.map(([bucket, label]) => {
      const rows = leads.filter((lead) => termBucket(lead) === bucket);
      return {
        label,
        inquiryCount: rows.length,
        viewingRate: rows.length
          ? Math.round((countFrom(rows, isViewed) / rows.length) * 1000) / 10
          : 0,
        registrationRate: registrationRate(rows),
        churnRate: rows.length
          ? Math.round(
              (countFrom(rows, (lead) => lead.outcome.outcome === "CHURNED") /
                rows.length) *
                1000,
            ) / 10
          : 0,
      };
    }),
    unmetDemand: [...unmetDemand.entries()]
      .map(([region, count]) => ({ region, count }))
      .sort(
        (left, right) =>
          right.count - left.count || left.region.localeCompare(right.region),
      ),
  };
}

function countFrom(
  items: LeadRecord[],
  predicate: (lead: LeadRecord) => boolean,
): number {
  return items.filter(predicate).length;
}

export class SupabaseLeadRepository implements LeadRepository {
  private readonly supabase = createAdminClient();

  private async relatedData(leadIds: string[]) {
    if (!leadIds.length) {
      return {
        listingNameById: new Map<string, string>(),
        eventsByLead: new Map<string, LeadListingEvent[]>(),
        viewingsByLead: new Map<string, LeadViewingEvent[]>(),
        outcomeByLead: new Map<string, JsonRow>(),
      };
    }
    const [eventsResult, viewingsResult, outcomesResult, leadsResult] =
      await Promise.all([
        this.supabase
          .from("lead_listing_events")
          .select("*")
          .in("lead_id", leadIds),
        this.supabase.from("viewing_events").select("*").in("lead_id", leadIds),
        this.supabase.from("lead_outcomes").select("*").in("lead_id", leadIds),
        this.supabase
          .from("leads")
          .select("original_listing_id")
          .in("id", leadIds),
      ]);
    const error =
      eventsResult.error ??
      viewingsResult.error ??
      outcomesResult.error ??
      leadsResult.error;
    if (error) throw error;
    const listingIds = [
      ...new Set(
        ((leadsResult.data ?? []) as JsonRow[])
          .map((row) => stringValue(row.original_listing_id))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const listingsResult = listingIds.length
      ? await this.supabase.from("homes").select("id,name").in("id", listingIds)
      : { data: [], error: null };
    if (listingsResult.error) throw listingsResult.error;

    const eventsByLead = new Map<string, LeadListingEvent[]>();
    for (const row of (eventsResult.data ?? []) as JsonRow[]) {
      const event = mapListingEvent(row);
      const current = eventsByLead.get(String(row.lead_id)) ?? [];
      current.push(event);
      eventsByLead.set(String(row.lead_id), current);
    }
    const viewingsByLead = new Map<string, LeadViewingEvent[]>();
    for (const row of (viewingsResult.data ?? []) as JsonRow[]) {
      const event = mapViewingEvent(row);
      const current = viewingsByLead.get(String(row.lead_id)) ?? [];
      current.push(event);
      viewingsByLead.set(String(row.lead_id), current);
    }
    const outcomeByLead = new Map(
      ((outcomesResult.data ?? []) as JsonRow[]).map((row) => [
        String(row.lead_id),
        row,
      ]),
    );
    const listingNameById = new Map(
      ((listingsResult.data ?? []) as JsonRow[]).map((row) => [
        String(row.id),
        String(row.name),
      ]),
    );
    return { listingNameById, eventsByLead, viewingsByLead, outcomeByLead };
  }

  private async allLeads(): Promise<LeadRecord[]> {
    const rows = await fetchAllSupabaseRows<JsonRow>((from, to) =>
      this.supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    const related = await this.relatedData(rows.map((row) => String(row.id)));
    return rows.map((row) => mapLead(row, related));
  }

  async getDashboard(filters?: LeadFilters): Promise<LeadDashboard> {
    const [leads, listingsResult, adminsResult] = await Promise.all([
      this.allLeads(),
      this.supabase
        .from("homes")
        .select("id,name,city,district")
        .eq("is_active", true)
        .order("name"),
      this.supabase
        .from("admin_memberships")
        .select("user_id")
        .eq("is_active", true)
        .order("created_at"),
    ]);
    if (listingsResult.error ?? adminsResult.error)
      throw listingsResult.error ?? adminsResult.error;
    return {
      leads: filterLeads(leads, filters),
      availableListings: ((listingsResult.data ?? []) as JsonRow[]).map(
        (row) => ({
          id: String(row.id),
          name: String(row.name),
          city: stringValue(row.city),
          district: stringValue(row.district),
        }),
      ),
      admins: ((adminsResult.data ?? []) as JsonRow[]).map((row) => ({
        id: String(row.user_id),
        label: `관리자 ${String(row.user_id).slice(0, 8)}`,
      })),
    };
  }

  async getLead(id: string): Promise<LeadRecord | null> {
    const { data, error } = await this.supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as JsonRow;
    return mapLead(row, await this.relatedData([id]));
  }

  async createLead(input: CreateLeadInput): Promise<LeadRecord> {
    const { data, error } = await this.supabase
      .from("leads")
      .insert({
        customer_label: input.customerLabel,
        customer_type: input.customerType ?? "UNKNOWN",
        customer_tags: input.customerTags ?? [],
        source: input.source,
        source_detail: input.sourceDetail,
        utm_source: input.utm?.source,
        utm_medium: input.utm?.medium,
        utm_campaign: input.utm?.campaign,
        utm_term: input.utm?.term,
        utm_content: input.utm?.content,
        landing_path: input.landingPath,
        desired_region: input.desiredRegion,
        desired_move_in: input.desiredMoveIn,
        desired_term_months: input.desiredTermMonths,
        budget_monthly: input.budgetMonthly,
        budget_deposit: input.budgetDeposit,
        must_have: input.mustHave ?? [],
        original_listing_id: input.originalListingId,
      })
      .select("*")
      .single();
    if (error) throw error;
    const created = data as JsonRow;
    if (input.originalListingId) {
      const { error: eventError } = await this.supabase
        .from("lead_listing_events")
        .insert({
          lead_id: created.id,
          listing_id: input.originalListingId,
          event_type: "INQUIRY",
        });
      if (eventError) throw eventError;
    }
    const lead = await this.getLead(String(created.id));
    if (!lead) throw new Error("LEAD_CREATE_READBACK_FAILED");
    return lead;
  }

  async recordListingEvent(
    leadId: string,
    listingId: string,
    eventType: "IMPRESSION" | "CLICK",
  ): Promise<void> {
    const { error } = await this.supabase.from("lead_listing_events").insert({
      lead_id: leadId,
      listing_id: listingId,
      event_type: eventType,
    });
    if (error) throw error;
  }

  async requestViewing(
    leadId: string,
    listingId: string,
    slotId?: string,
  ): Promise<LeadRecord | null> {
    const { data: viewing, error: viewingError } = await this.supabase
      .from("viewing_events")
      .insert({ lead_id: leadId, listing_id: listingId, slot_id: slotId })
      .select("id")
      .single();
    if (viewingError) throw viewingError;
    if (slotId) {
      const { data: slot, error: slotError } = await this.supabase
        .from("viewing_slots")
        .update({ is_available: false })
        .eq("id", slotId)
        .eq("listing_id", listingId)
        .eq("is_available", true)
        .select("id")
        .maybeSingle();
      if (slotError) throw slotError;
      if (!slot) {
        await this.supabase
          .from("viewing_events")
          .delete()
          .eq("id", (viewing as JsonRow).id);
        throw new Error("VIEWING_SLOT_UNAVAILABLE");
      }
    }
    const { error: listingEventError } = await this.supabase
      .from("lead_listing_events")
      .insert({
        lead_id: leadId,
        listing_id: listingId,
        event_type: "VIEWING_REQUEST",
        metadata: { viewingEventId: (viewing as JsonRow).id },
      });
    if (listingEventError) throw listingEventError;
    const { error: leadError } = await this.supabase
      .from("leads")
      .update({
        status: "VIEWING_REQUESTED",
        last_contact_at: new Date().toISOString(),
      })
      .eq("id", leadId);
    if (leadError) throw leadError;
    return this.getLead(leadId);
  }

  async updateLead(
    id: string,
    adminId: string,
    input: LeadActionInput,
  ): Promise<LeadRecord | null> {
    const now = new Date().toISOString();
    if (input.action === "RESPOND") {
      const { error } = await this.supabase
        .from("leads")
        .update({
          first_response_at: now,
          last_contact_at: now,
          status: "CONTACTED",
        })
        .eq("id", id)
        .is("first_response_at", null);
      if (error) throw error;
    } else if (input.action === "ASSIGN") {
      const { error } = await this.supabase
        .from("leads")
        .update({ assigned_admin_id: input.assignedAdminId ?? adminId })
        .eq("id", id);
      if (error) throw error;
    } else if (input.action === "RECOMMEND_ALTERNATIVE") {
      const { error: eventError } = await this.supabase
        .from("lead_listing_events")
        .insert({
          lead_id: id,
          listing_id: input.listingId,
          event_type: "ALTERNATIVE_RECOMMENDATION",
        });
      if (eventError) throw eventError;
      const { error } = await this.supabase
        .from("leads")
        .update({ alternative_listing_used: true, last_contact_at: now })
        .eq("id", id);
      if (error) throw error;
    } else if (input.action === "REQUEST_VIEWING") {
      const { data, error } = await this.supabase
        .from("viewing_events")
        .insert({
          lead_id: id,
          listing_id: input.listingId,
          slot_id: input.slotId,
          created_by_admin_id: adminId,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (input.slotId) {
        const { error: slotError } = await this.supabase
          .from("viewing_slots")
          .update({ is_available: false })
          .eq("id", input.slotId)
          .eq("is_available", true);
        if (slotError) throw slotError;
      }
      const { error: listingEventError } = await this.supabase
        .from("lead_listing_events")
        .insert({
          lead_id: id,
          listing_id: input.listingId,
          event_type: "VIEWING_REQUEST",
          metadata: { viewingEventId: data.id },
        });
      if (listingEventError) throw listingEventError;
      const { error: leadError } = await this.supabase
        .from("leads")
        .update({ status: "VIEWING_REQUESTED", last_contact_at: now })
        .eq("id", id);
      if (leadError) throw leadError;
    } else if (input.action === "CONFIRM_VIEWING") {
      const { error: viewingError } = await this.supabase
        .from("viewing_events")
        .update({ confirmed_at: now })
        .eq("id", input.viewingEventId)
        .eq("lead_id", id)
        .is("cancelled_at", null);
      if (viewingError) throw viewingError;
      const { error } = await this.supabase
        .from("leads")
        .update({ status: "VIEWING_CONFIRMED", last_contact_at: now })
        .eq("id", id);
      if (error) throw error;
    } else if (input.action === "COMPLETE_VIEWING") {
      const { error: viewingError } = await this.supabase
        .from("viewing_events")
        .update({ viewing_at: input.viewingAt ?? now })
        .eq("id", input.viewingEventId)
        .eq("lead_id", id)
        .is("cancelled_at", null);
      if (viewingError) throw viewingError;
      const { error } = await this.supabase
        .from("leads")
        .update({ status: "VIEWED", last_contact_at: now })
        .eq("id", id);
      if (error) throw error;
    } else if (input.action === "CANCEL_VIEWING") {
      const { data, error: viewingError } = await this.supabase
        .from("viewing_events")
        .update({
          cancelled_at: now,
          cancellation_actor: input.cancellationActor,
          cancellation_reason: input.cancellationReason,
        })
        .eq("id", input.viewingEventId)
        .eq("lead_id", id)
        .is("cancelled_at", null)
        .select("slot_id")
        .maybeSingle();
      if (viewingError) throw viewingError;
      const slotId = stringValue((data as JsonRow | null)?.slot_id);
      if (slotId) {
        const { error: slotError } = await this.supabase
          .from("viewing_slots")
          .update({ is_available: true })
          .eq("id", slotId);
        if (slotError) throw slotError;
      }
    } else if (input.action === "CHURN" || input.action === "REGISTER") {
      const outcome: LeadOutcome =
        input.action === "CHURN" ? "CHURNED" : "REGISTERED";
      const { error: outcomeError } = await this.supabase
        .from("lead_outcomes")
        .upsert({
          lead_id: id,
          outcome,
          churn_stage: input.action === "CHURN" ? input.churnStage : null,
          churn_reason: input.action === "CHURN" ? input.churnReason : null,
          churn_reason_note:
            input.action === "CHURN" ? input.churnReasonNote : null,
          closed_at: now,
          updated_by_admin_id: adminId,
        });
      if (outcomeError) throw outcomeError;
      const { error } = await this.supabase
        .from("leads")
        .update({ status: outcome, last_contact_at: now })
        .eq("id", id);
      if (error) throw error;
    }

    const lead = await this.getLead(id);
    if (!lead) return null;
    const { error: auditError } = await this.supabase
      .from("audit_logs")
      .insert({
        admin_id: adminId,
        entity_type: "LEAD",
        entity_id: id,
        action: `LEAD_${input.action}`,
        after_json: {
          status: lead.status,
          outcome: lead.outcome.outcome,
          assignedAdminId: lead.assignedAdminId ?? null,
        },
      });
    if (auditError) throw auditError;
    return lead;
  }

  async listAvailableSlots(
    listingId: string,
    from = new Date().toISOString(),
  ): Promise<LeadListingSlot[]> {
    const { data, error } = await this.supabase
      .from("viewing_slots")
      .select("*")
      .eq("listing_id", listingId)
      .eq("is_available", true)
      .gte("starts_at", from)
      .order("starts_at");
    if (error) throw error;
    return ((data ?? []) as JsonRow[]).map((row) => ({
      id: String(row.id),
      listingId: String(row.listing_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      isAvailable: row.is_available === true,
      notes: stringValue(row.notes),
    }));
  }

  async createViewingSlot(
    input: CreateViewingSlotInput,
    adminId: string,
  ): Promise<LeadListingSlot> {
    const { data, error } = await this.supabase
      .from("viewing_slots")
      .insert({
        listing_id: input.listingId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        notes: input.notes,
        created_by_admin_id: input.hostProfileId ? null : adminId,
        created_by_host_profile_id: input.hostProfileId,
      })
      .select("*")
      .single();
    if (error) throw error;
    const row = data as JsonRow;
    return {
      id: String(row.id),
      listingId: String(row.listing_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      isAvailable: row.is_available === true,
      notes: stringValue(row.notes),
    };
  }

  async getAnalytics(filters?: LeadFilters): Promise<LeadAnalytics> {
    return buildLeadAnalytics(filterLeads(await this.allLeads(), filters));
  }

  async importLeads(input: {
    adminId: string;
    fileName: string;
    fileSha256: string;
    sourceSystem: string;
    rows: ImportLeadRow[];
  }) {
    const { data: previous, error: previousError } = await this.supabase
      .from("lead_import_batches")
      .select("id,imported_rows,skipped_rows")
      .eq("file_sha256", input.fileSha256)
      .eq("status", "APPLIED")
      .maybeSingle();
    if (previousError) throw previousError;
    if (previous) {
      const row = previous as JsonRow;
      return {
        batchId: String(row.id),
        importedRows: numberValue(row.imported_rows) ?? 0,
        skippedRows: numberValue(row.skipped_rows) ?? 0,
        alreadyApplied: true,
      };
    }
    const { data: batch, error: batchError } = await this.supabase
      .from("lead_import_batches")
      .insert({
        created_by: input.adminId,
        file_name: input.fileName,
        file_sha256: input.fileSha256,
        source_system: input.sourceSystem,
        total_rows: input.rows.length,
      })
      .select("id")
      .single();
    if (batchError) throw batchError;
    let importedRows = 0;
    let skippedRows = 0;
    try {
      for (const row of input.rows) {
        const { data: existing, error: existingError } = await this.supabase
          .from("leads")
          .select("id")
          .eq("import_source", input.sourceSystem)
          .eq("import_record_id", row.importRecordId)
          .maybeSingle();
        if (existingError) throw existingError;
        const values = {
          customer_label: row.customerLabel,
          customer_type: row.customerType ?? "UNKNOWN",
          customer_tags: row.customerTags ?? [],
          source: row.source,
          source_detail: row.sourceDetail,
          utm_source: row.utm?.source,
          utm_medium: row.utm?.medium,
          utm_campaign: row.utm?.campaign,
          utm_term: row.utm?.term,
          utm_content: row.utm?.content,
          landing_path: row.landingPath,
          desired_region: row.desiredRegion,
          desired_move_in: row.desiredMoveIn,
          desired_term_months: row.desiredTermMonths,
          budget_monthly: row.budgetMonthly,
          budget_deposit: row.budgetDeposit,
          must_have: row.mustHave ?? [],
          original_listing_id: row.originalListingId,
          import_source: input.sourceSystem,
          import_record_id: row.importRecordId,
          import_confidence: row.confidence ?? "LOW",
        };
        if (existing) {
          const { error } = await this.supabase
            .from("leads")
            .update(values)
            .eq("id", (existing as JsonRow).id);
          if (error) throw error;
          skippedRows += 1;
        } else {
          const { error } = await this.supabase.from("leads").insert(values);
          if (error) throw error;
          importedRows += 1;
        }
      }
      const { error: appliedError } = await this.supabase
        .from("lead_import_batches")
        .update({
          status: "APPLIED",
          imported_rows: importedRows,
          skipped_rows: skippedRows,
          applied_at: new Date().toISOString(),
        })
        .eq("id", (batch as JsonRow).id);
      if (appliedError) throw appliedError;
    } catch (error) {
      await this.supabase
        .from("lead_import_batches")
        .update({
          status: "FAILED",
          imported_rows: importedRows,
          skipped_rows: skippedRows,
          error_summary: [{ code: "IMPORT_FAILED" }],
        })
        .eq("id", (batch as JsonRow).id);
      throw error;
    }
    return {
      batchId: String((batch as JsonRow).id),
      importedRows,
      skippedRows,
      alreadyApplied: false,
    };
  }
}

export class MemoryLeadRepository implements LeadRepository {
  private readonly leads: LeadRecord[] = [];
  private readonly slots: LeadListingSlot[] = [];

  async getDashboard(filters?: LeadFilters): Promise<LeadDashboard> {
    return {
      leads: filterLeads(this.leads, filters),
      availableListings: [],
      admins: [],
    };
  }

  async getLead(id: string): Promise<LeadRecord | null> {
    return this.leads.find((lead) => lead.id === id) ?? null;
  }

  async createLead(input: CreateLeadInput): Promise<LeadRecord> {
    const lead: LeadRecord = {
      id: randomUUID(),
      customerLabel: input.customerLabel,
      customerType: input.customerType ?? "UNKNOWN",
      customerTags: input.customerTags ?? [],
      source: input.source,
      sourceDetail: input.sourceDetail,
      utm: input.utm ?? {},
      landingPath: input.landingPath,
      desiredRegion: input.desiredRegion,
      desiredMoveIn: input.desiredMoveIn,
      desiredTermMonths: input.desiredTermMonths,
      budgetMonthly: input.budgetMonthly,
      budgetDeposit: input.budgetDeposit,
      mustHave: input.mustHave ?? [],
      status: "NEW",
      originalListingId: input.originalListingId,
      alternativeListingUsed: false,
      createdAt: new Date().toISOString(),
      outcome: { outcome: "ONGOING" },
      viewingEvents: [],
      listingEvents: input.originalListingId
        ? [
            {
              id: randomUUID(),
              listingId: input.originalListingId,
              eventType: "INQUIRY",
              occurredAt: new Date().toISOString(),
            },
          ]
        : [],
    };
    this.leads.unshift(lead);
    return lead;
  }

  async recordListingEvent(
    leadId: string,
    listingId: string,
    eventType: "IMPRESSION" | "CLICK",
  ): Promise<void> {
    const lead = await this.getLead(leadId);
    if (!lead) throw new Error("LEAD_NOT_FOUND");
    lead.listingEvents.push({
      id: randomUUID(),
      listingId,
      eventType,
      occurredAt: new Date().toISOString(),
    });
  }

  async requestViewing(
    leadId: string,
    listingId: string,
    slotId?: string,
  ): Promise<LeadRecord | null> {
    return this.updateLead(leadId, "", {
      action: "REQUEST_VIEWING",
      listingId,
      slotId,
    });
  }

  async updateLead(
    id: string,
    _adminId: string,
    input: LeadActionInput,
  ): Promise<LeadRecord | null> {
    const lead = await this.getLead(id);
    if (!lead) return null;
    const now = new Date().toISOString();
    if (input.action === "RESPOND") {
      lead.firstResponseAt ??= now;
      lead.lastContactAt = now;
      lead.status = "CONTACTED";
    } else if (input.action === "ASSIGN")
      lead.assignedAdminId = input.assignedAdminId;
    else if (input.action === "RECOMMEND_ALTERNATIVE") {
      lead.alternativeListingUsed = true;
      lead.listingEvents.push({
        id: randomUUID(),
        listingId: input.listingId,
        eventType: "ALTERNATIVE_RECOMMENDATION",
        occurredAt: now,
      });
    } else if (input.action === "REQUEST_VIEWING") {
      lead.status = "VIEWING_REQUESTED";
      lead.viewingEvents.push({
        id: randomUUID(),
        listingId: input.listingId,
        slotId: input.slotId,
        requestedAt: now,
      });
    } else if (
      input.action === "CONFIRM_VIEWING" ||
      input.action === "COMPLETE_VIEWING" ||
      input.action === "CANCEL_VIEWING"
    ) {
      const viewing = lead.viewingEvents.find(
        (item) => item.id === input.viewingEventId,
      );
      if (!viewing) return lead;
      if (input.action === "CONFIRM_VIEWING") {
        viewing.confirmedAt = now;
        lead.status = "VIEWING_CONFIRMED";
      } else if (input.action === "COMPLETE_VIEWING") {
        viewing.viewingAt = input.viewingAt ?? now;
        lead.status = "VIEWED";
      } else {
        viewing.cancelledAt = now;
        viewing.cancellationActor = input.cancellationActor;
        viewing.cancellationReason = input.cancellationReason;
      }
    } else if (input.action === "REGISTER") {
      lead.status = "REGISTERED";
      lead.outcome = { outcome: "REGISTERED", closedAt: now };
    } else if (input.action === "CHURN") {
      lead.status = "CHURNED";
      lead.outcome = {
        outcome: "CHURNED",
        churnStage: input.churnStage,
        churnReason: input.churnReason,
        churnReasonNote: input.churnReasonNote,
        closedAt: now,
      };
    }
    return lead;
  }

  async listAvailableSlots(listingId: string, from = new Date().toISOString()) {
    return this.slots.filter(
      (slot) =>
        slot.listingId === listingId &&
        slot.isAvailable &&
        slot.startsAt >= from,
    );
  }

  async createViewingSlot(
    input: CreateViewingSlotInput,
    _adminId: string,
  ): Promise<LeadListingSlot> {
    void _adminId;
    const slot = {
      id: randomUUID(),
      listingId: input.listingId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      isAvailable: true,
      notes: input.notes,
    };
    this.slots.push(slot);
    return slot;
  }

  async getAnalytics(filters?: LeadFilters) {
    return buildLeadAnalytics(filterLeads(this.leads, filters));
  }

  async importLeads(input: {
    adminId: string;
    fileName: string;
    fileSha256: string;
    sourceSystem: string;
    rows: ImportLeadRow[];
  }) {
    // Keep the development repository signature identical to production so
    // route-level authorization is exercised even though there is no audit DB.
    void input.adminId;
    let importedRows = 0;
    for (const row of input.rows) {
      await this.createLead(row);
      importedRows += 1;
    }
    return {
      batchId: randomUUID(),
      importedRows,
      skippedRows: 0,
      alreadyApplied: false,
    };
  }
}
