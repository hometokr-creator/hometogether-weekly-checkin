export const leadCustomerTypes = [
  "GUEST",
  "HOST",
  "GUEST_PARENT",
  "HOST_CHILD",
  "UNKNOWN",
] as const;
export type LeadCustomerType = (typeof leadCustomerTypes)[number];

export const leadSources = [
  "KAKAO",
  "EVERYTIME",
  "INSTAGRAM",
  "WEBSITE",
  "REFERRAL",
  "ETC",
] as const;
export type LeadSource = (typeof leadSources)[number];

export const leadStatuses = [
  "NEW",
  "CONTACTED",
  "VIEWING_REQUESTED",
  "VIEWING_CONFIRMED",
  "VIEWED",
  "REGISTERED",
  "CHURNED",
] as const;
export type LeadStatus = (typeof leadStatuses)[number];

export const leadOutcomes = ["ONGOING", "REGISTERED", "CHURNED"] as const;
export type LeadOutcome = (typeof leadOutcomes)[number];

export const leadChurnStages = [
  "INQUIRY",
  "VIEWING_SCHEDULED",
  "AFTER_VIEWING",
  "AFTER_REGISTRATION",
] as const;
export type LeadChurnStage = (typeof leadChurnStages)[number];

export const leadChurnReasons = [
  "RESPONSE_DELAY",
  "LISTING_CONDITION",
  "LOCATION",
  "NO_INVENTORY",
  "CONTRACT_TERM",
  "PRICE",
  "DEPOSIT",
  "MOVE_IN_REGISTRATION",
  "KITCHEN",
  "CURFEW",
  "HOST_INFO",
  "FAMILY_OPPOSITION",
  "OTHER_PROPERTY",
  "PERSONAL_REASON",
  "UNKNOWN",
] as const;
export type LeadChurnReason = (typeof leadChurnReasons)[number];

export const listingEventTypes = [
  "IMPRESSION",
  "CLICK",
  "INQUIRY",
  "VIEWING_REQUEST",
  "ALTERNATIVE_RECOMMENDATION",
] as const;
export type ListingEventType = (typeof listingEventTypes)[number];

export type LeadSlaStatus =
  "ON_TRACK" | "WARNING" | "BREACHED" | "ESCALATED" | "RESPONDED";

export type LeadOutcomeRecord = {
  outcome: LeadOutcome;
  churnStage?: LeadChurnStage;
  churnReason?: LeadChurnReason;
  churnReasonNote?: string;
  closedAt?: string;
};

export type LeadViewingEvent = {
  id: string;
  listingId: string;
  slotId?: string;
  requestedAt: string;
  confirmedAt?: string;
  viewingAt?: string;
  cancelledAt?: string;
  cancellationActor?: "CUSTOMER" | "HOST" | "ADMIN" | "SYSTEM";
  cancellationReason?: string;
};

export type LeadListingEvent = {
  id: string;
  listingId: string;
  eventType: ListingEventType;
  occurredAt: string;
};

export type LeadRecord = {
  id: string;
  customerProfileId?: string;
  customerLabel?: string;
  customerType: LeadCustomerType;
  customerTags: string[];
  source: LeadSource;
  sourceDetail?: string;
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  landingPath?: string;
  desiredRegion?: string;
  desiredMoveIn?: string;
  desiredTermMonths?: number;
  budgetMonthly?: number;
  budgetDeposit?: number;
  mustHave: string[];
  status: LeadStatus;
  originalListingId?: string;
  originalListingName?: string;
  originalListingAvailable?: boolean;
  alternativeListingUsed: boolean;
  createdAt: string;
  firstResponseAt?: string;
  lastContactAt?: string;
  assignedAdminId?: string;
  outcome: LeadOutcomeRecord;
  viewingEvents: LeadViewingEvent[];
  listingEvents: LeadListingEvent[];
  importConfidence?: "HIGH" | "MEDIUM" | "LOW";
};

export type LeadListingSlot = {
  id: string;
  listingId: string;
  startsAt: string;
  endsAt: string;
  isAvailable: boolean;
  notes?: string;
};

export type LeadFilters = {
  from?: string;
  to?: string;
  source?: LeadSource;
  customerType?: LeadCustomerType;
  region?: string;
  term?: "ONE" | "TWO_TO_THREE" | "FOUR" | "FIVE_TO_SIX" | "OVER_SIX";
  stage?: LeadStatus;
  outcome?: LeadOutcome;
  churnReason?: LeadChurnReason;
  assignedAdminId?: string;
};

export type LeadDashboard = {
  leads: LeadRecord[];
  availableListings: Array<{
    id: string;
    name: string;
    city?: string;
    district?: string;
  }>;
  admins: Array<{ id: string; label: string }>;
};

export type LeadAnalytics = {
  funnel: Array<{ stage: string; count: number; conversionRate: number }>;
  churnReasons: Array<{ reason: LeadChurnReason; count: number; rate: number }>;
  sla: {
    withinTenMinuteConversionRate: number;
    overTenMinuteConversionRate: number;
    averageFirstResponseMinutes?: number;
    medianFirstResponseMinutes?: number;
  };
  listingComparison: {
    originalAvailableRegistrationRate: number;
    alternativeRegistrationRate: number;
  };
  termBuckets: Array<{
    label: string;
    inquiryCount: number;
    viewingRate: number;
    registrationRate: number;
    churnRate: number;
  }>;
  unmetDemand: Array<{ region: string; count: number }>;
};

export type CreateLeadInput = {
  customerLabel?: string;
  customerType?: LeadCustomerType;
  customerTags?: string[];
  source: LeadSource;
  sourceDetail?: string;
  utm?: LeadRecord["utm"];
  landingPath?: string;
  desiredRegion?: string;
  desiredMoveIn?: string;
  desiredTermMonths?: number;
  budgetMonthly?: number;
  budgetDeposit?: number;
  mustHave?: string[];
  originalListingId?: string;
};
