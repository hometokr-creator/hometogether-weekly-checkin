import "server-only";

import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import type { CheckinRepository, DispatchCandidate } from "@/lib/checkin/repository";
import { createMessagingProvider, type MessagingProvider } from "@/lib/messaging";
import { sanitizeProviderError, type MessagingResult } from "@/lib/messaging/provider";

export interface DispatchSummary {
  created: number;
  sent: number;
  failed: number;
}

function getBaseUrl() {
  const value = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!value) throw new Error("APP_BASE_URL is required");
  return value.replace(/\/$/, "");
}

async function sendCandidate(
  candidate: DispatchCandidate,
  messageType: "WEEKLY_CHECKIN" | "WEEKLY_CHECKIN_REMINDER",
  repository: CheckinRepository,
  provider: MessagingProvider,
  appBaseUrl: string,
): Promise<MessagingResult> {
  let result: MessagingResult;
  try {
    result = await provider.sendWeeklyCheckin({
      recipientId: candidate.invitation.participantId,
      phone: candidate.phone,
      name: candidate.recipientName,
      counterpartLabel: candidate.counterpartLabel,
      period: candidate.period,
      deadline: candidate.deadline,
      checkinUrl: `${appBaseUrl}/checkin/${encodeURIComponent(candidate.rawToken)}`,
      idempotencyKey: candidate.idempotencyKey,
    });
  } catch (error) {
    result = {
      success: false,
      errorCode: "PROVIDER_UNEXPECTED_ERROR",
      errorMessage: sanitizeProviderError(error),
    };
  }

  await repository.recordMessageResult(
    candidate,
    candidate.messageType ?? messageType,
    process.env.MESSAGING_PROVIDER === "kakao" ? "kakao" : "mock",
    result,
  );
  return result;
}

export async function createWeeklyCheckins(options: {
  now?: Date;
  repository?: CheckinRepository;
  provider?: MessagingProvider;
  appBaseUrl?: string;
} = {}): Promise<DispatchSummary> {
  const repository = options.repository ?? (await getCheckinRepository());
  const provider = options.provider ?? createMessagingProvider();
  const candidates = await repository.createWeeklyInvitations(options.now ?? new Date());
  const results = await Promise.all(
    candidates.map((candidate) =>
      sendCandidate(
        candidate,
        "WEEKLY_CHECKIN",
        repository,
        provider,
        options.appBaseUrl ?? getBaseUrl(),
      ),
    ),
  );
  return {
    created: candidates.length,
    sent: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
  };
}

export async function sendCheckinReminders(options: {
  now?: Date;
  repository?: CheckinRepository;
  provider?: MessagingProvider;
  appBaseUrl?: string;
} = {}): Promise<DispatchSummary> {
  const repository = options.repository ?? (await getCheckinRepository());
  const provider = options.provider ?? createMessagingProvider();
  const candidates = await repository.createReminderCandidates(options.now ?? new Date());
  const results = await Promise.all(
    candidates.map((candidate) =>
      sendCandidate(
        candidate,
        "WEEKLY_CHECKIN_REMINDER",
        repository,
        provider,
        options.appBaseUrl ?? getBaseUrl(),
      ),
    ),
  );
  return {
    created: candidates.length,
    sent: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
  };
}
