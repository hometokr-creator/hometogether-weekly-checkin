import "server-only";

import type { CheckinRepository, DispatchCandidate } from "@/lib/checkin/repository";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import {
  getAlimtalkRuntimeConfig,
  getMessageQueueProvider,
  getMessagingConfigurationStatus,
  getPublicCheckinBaseUrl,
} from "@/lib/messaging/config";
import { createMessagingProvider, type MessagingProvider } from "@/lib/messaging";
import {
  sanitizeProviderError,
  validateWeeklyCheckinMessageInput,
  type MessagingResult,
  type WeeklyCheckinMessageInput,
} from "@/lib/messaging/provider";

const DEFAULT_LIMIT = 25;
const CONCURRENCY = 5;

export type MessageOutboxDispatchSummary = {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  reconciled: number;
  blocked: boolean;
  blockedReasons: string[];
};

function messageInput(
  candidate: DispatchCandidate,
  baseUrl: string,
  templateCode: string,
): WeeklyCheckinMessageInput | null {
  const checkinUrl =
    candidate.deliveryScope === "ADMIN_TEST"
      ? `${baseUrl}/privacy/checkin`
      : candidate.rawToken
        ? `${baseUrl}/checkin/${encodeURIComponent(candidate.rawToken)}`
        : undefined;
  if (!checkinUrl) return null;

  const input: WeeklyCheckinMessageInput = {
    recipientId: candidate.recipientId,
    phone: candidate.phone,
    name: candidate.recipientName,
    counterpartLabel: candidate.counterpartLabel,
    period: candidate.period,
    deadline: candidate.deadline,
    checkinUrl,
    idempotencyKey: candidate.idempotencyKey,
    templateCode,
  };
  return validateWeeklyCheckinMessageInput(input).success ? input : null;
}

async function reconcileUnknown(
  candidate: DispatchCandidate,
  provider: MessagingProvider,
): Promise<MessagingResult | null> {
  // A provider reference means the provider may already have accepted the
  // request, even when the transport classified the attempt as transient.
  // Reconcile first and never blindly resend a referenced provider request.
  if (candidate.failureClass !== "UNKNOWN" && !candidate.providerMessageId) return null;
  let status;
  try {
    status = await provider.getStatus({
      idempotencyKey: candidate.idempotencyKey,
      providerMessageId: candidate.providerMessageId,
    });
  } catch (error) {
    status = {
      success: false as const,
      status: "UNKNOWN" as const,
      errorCode: "PROVIDER_STATUS_LOOKUP_ERROR",
      errorMessage: sanitizeProviderError(error),
      failureClass: "UNKNOWN" as const,
    };
  }
  if (["ACCEPTED", "SENT", "DELIVERED"].includes(status.status)) {
    return { ...status, success: true };
  }
  if (status.status === "FAILED") {
    return {
      ...status,
      success: false,
      errorCode: status.errorCode ?? "PROVIDER_DELIVERY_FAILED",
      failureClass: "PERMANENT",
    };
  }
  if (
    (candidate.attemptCount ?? 1) >= (candidate.maxAttempts ?? 5)
  ) {
    return {
      ...status,
      success: false,
      errorCode: "DELIVERY_UNRESOLVED_MAX_ATTEMPTS",
      errorMessage: "Provider delivery remains unresolved and requires manual review.",
      failureClass: "PERMANENT",
    };
  }
  return {
    ...status,
    success: false,
    errorCode:
      status.status === "ACCEPTED" || status.status === "SENT"
        ? "PROVIDER_DELIVERY_PENDING"
        : status.errorCode ?? "PROVIDER_DELIVERY_UNKNOWN",
    failureClass: "UNKNOWN",
  };
}

async function dispatchCandidate(options: {
  candidate: DispatchCandidate;
  repository: CheckinRepository;
  provider: MessagingProvider;
  baseUrl: string;
  templateCode: string;
}): Promise<{ result: MessagingResult; reconciled: boolean }> {
  const { candidate, repository, provider, baseUrl, templateCode } = options;
  const reconciled = await reconcileUnknown(candidate, provider);
  if (reconciled) {
    await repository.recordMessageResult(
      candidate,
      candidate.messageType ?? "WEEKLY_CHECKIN",
      getMessageQueueProvider(),
      reconciled,
    );
    return { result: reconciled, reconciled: true };
  }

  const input = messageInput(candidate, baseUrl, templateCode);
  if (!input) {
    const invalid: MessagingResult = {
      success: false,
      errorCode: "INVALID_OUTBOX_MESSAGE",
      errorMessage: "Outbox recipient or template variables are invalid.",
      failureClass: "PERMANENT",
    };
    await repository.recordMessageResult(
      candidate,
      candidate.messageType ?? "WEEKLY_CHECKIN",
      getMessageQueueProvider(),
      invalid,
    );
    return { result: invalid, reconciled: false };
  }

  await repository.saveMessageTemplate(candidate, templateCode, {
    name: input.name,
    counterpartLabel: input.counterpartLabel,
    period: input.period,
    deadline: input.deadline,
  });

  let result: MessagingResult;
  try {
    result = await provider.sendWeeklyCheckin(input);
  } catch (error) {
    result = {
      success: false,
      errorCode: "PROVIDER_UNEXPECTED_ERROR",
      errorMessage: sanitizeProviderError(error),
      failureClass: "TRANSIENT",
    };
  }
  await repository.recordMessageResult(
    candidate,
    candidate.messageType ?? "WEEKLY_CHECKIN",
    getMessageQueueProvider(),
    result,
  );
  return { result, reconciled: false };
}

export async function dispatchMessageOutbox(options: {
  repository?: CheckinRepository;
  provider?: MessagingProvider;
  limit?: number;
} = {}): Promise<MessageOutboxDispatchSummary> {
  const configuration = getMessagingConfigurationStatus();
  const blockedReasons = configuration.missing.filter(
    (name) => name !== "CHECKIN_SENDING_ENABLED" || !configuration.readyForAdminTest,
  );
  if (!configuration.readyForAdminTest && !options.provider) {
    return {
      claimed: 0,
      sent: 0,
      retry: 0,
      failed: 0,
      reconciled: 0,
      blocked: true,
      blockedReasons,
    };
  }

  const repository = options.repository ?? (await getCheckinRepository());
  const provider = options.provider ?? createMessagingProvider();
  const runtimeConfig = options.provider
    ? { templateCode: "test-template" }
    : getAlimtalkRuntimeConfig();
  const baseUrl = getPublicCheckinBaseUrl();
  const candidates = await repository.claimMessageDeliveries({
    provider: getMessageQueueProvider(),
    allowProduction: configuration.readyForProduction,
    allowAdminTest: configuration.readyForAdminTest || Boolean(options.provider),
    limit: Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 100),
  });
  const outcomes: Array<{ result: MessagingResult; reconciled: boolean }> = [];

  for (let index = 0; index < candidates.length; index += CONCURRENCY) {
    outcomes.push(
      ...(await Promise.all(
        candidates.slice(index, index + CONCURRENCY).map((candidate) =>
          dispatchCandidate({
            candidate,
            repository,
            provider,
            baseUrl,
            templateCode: runtimeConfig.templateCode,
          }),
        ),
      )),
    );
  }

  return {
    claimed: candidates.length,
    sent: outcomes.filter(({ result }) => result.success).length,
    retry: outcomes.filter(
      ({ result }) => !result.success && result.failureClass !== "PERMANENT",
    ).length,
    failed: outcomes.filter(
      ({ result }) => !result.success && result.failureClass === "PERMANENT",
    ).length,
    reconciled: outcomes.filter((outcome) => outcome.reconciled).length,
    blocked: !configuration.readyForProduction,
    blockedReasons: configuration.readyForProduction
      ? []
      : configuration.missing,
  };
}
