export type EligibilityProfile = {
  id: string;
  active: boolean;
  notificationEnabled: boolean;
  phone: string | null;
};

export type EligibilityMatch = {
  id: string;
  status: string;
  moveInDate: string;
  moveOutDate: string | null;
  contractEndDate: string | null;
  homeActive: boolean;
  host: EligibilityProfile;
  guest: EligibilityProfile;
};

export type EligibilityExclusionCode =
  | "MATCH_NOT_ACTIVE"
  | "CONTRACT_NOT_STARTED"
  | "CONTRACT_ENDED"
  | "HOME_INACTIVE"
  | "PROFILE_INACTIVE"
  | "NOTIFICATION_DISABLED"
  | "PHONE_INVALID"
  | "ALREADY_CREATED"
  | "MULTIPLE_ACTIVE_MATCHES";

export type EligibilityTarget = {
  matchId: string;
  participantId: string;
  role: "HOST" | "GUEST";
};

export type EligibilityResult = {
  eligible: EligibilityTarget[];
  excluded: Array<EligibilityTarget & { code: EligibilityExclusionCode }>;
};

export function isNormalizedKoreanMobile(phone: string | null): boolean {
  return typeof phone === "string" && /^\+8210[0-9]{8}$/.test(phone);
}
export function evaluateWeeklyEligibility(input: {
  matches: readonly EligibilityMatch[];
  asOfDate: string;
  alreadyCreatedParticipantIds?: ReadonlySet<string>;
}): EligibilityResult {
  const eligibleCandidates: EligibilityTarget[] = [];
  const excluded: EligibilityResult["excluded"] = [];

  for (const match of input.matches) {
    const participants = [
      { profile: match.host, role: "HOST" as const },
      { profile: match.guest, role: "GUEST" as const },
    ];
    for (const { profile, role } of participants) {
      const target = { matchId: match.id, participantId: profile.id, role };
      let code: EligibilityExclusionCode | null = null;
      if (match.status !== "ACTIVE") code = "MATCH_NOT_ACTIVE";
      else if (match.moveInDate > input.asOfDate) code = "CONTRACT_NOT_STARTED";
      else if (
        (match.moveOutDate && match.moveOutDate < input.asOfDate) ||
        (match.contractEndDate && match.contractEndDate < input.asOfDate)
      ) code = "CONTRACT_ENDED";
      else if (!match.homeActive) code = "HOME_INACTIVE";
      else if (!profile.active) code = "PROFILE_INACTIVE";
      else if (!profile.notificationEnabled) code = "NOTIFICATION_DISABLED";
      else if (!isNormalizedKoreanMobile(profile.phone)) code = "PHONE_INVALID";
      else if (input.alreadyCreatedParticipantIds?.has(profile.id)) code = "ALREADY_CREATED";

      if (code) excluded.push({ ...target, code });
      else eligibleCandidates.push(target);
    }
  }

  const counts = new Map<string, number>();
  for (const candidate of eligibleCandidates) {
    counts.set(candidate.participantId, (counts.get(candidate.participantId) ?? 0) + 1);
  }

  const eligible: EligibilityTarget[] = [];
  for (const candidate of eligibleCandidates) {
    if ((counts.get(candidate.participantId) ?? 0) > 1) {
      excluded.push({ ...candidate, code: "MULTIPLE_ACTIVE_MATCHES" });
    } else {
      eligible.push(candidate);
    }
  }

  return { eligible, excluded };
}
