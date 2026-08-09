import "server-only";

import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import type { CheckinRepository } from "@/lib/checkin/repository";
import { getMessagingConfigurationStatus } from "@/lib/messaging/config";

export interface DispatchSummary {
  created: number;
  sent: number;
  failed: number;
  dataQualityCount: number;
  skipped: boolean;
  reason?: "SENDING_DISABLED" | "ALIMTALK_NOT_READY";
}

/**
 * Creates invitations and durable message rows only. Provider I/O is owned by
 * the independently retryable outbox processor.
 */
export async function createWeeklyCheckins(options: {
  now?: Date;
  repository?: CheckinRepository;
} = {}): Promise<DispatchSummary> {
  const configuration = getMessagingConfigurationStatus();
  if (!configuration.sendingEnabled || !configuration.readyForProduction) {
    return {
      created: 0,
      sent: 0,
      failed: 0,
      dataQualityCount: 0,
      skipped: true,
      reason: configuration.sendingEnabled ? "ALIMTALK_NOT_READY" : "SENDING_DISABLED",
    };
  }
  const repository = options.repository ?? (await getCheckinRepository());
  const result = await repository.enqueueWeeklyMessages(options.now ?? new Date());
  return {
    created: result.queued,
    sent: 0,
    failed: 0,
    dataQualityCount: result.dataQualityCount,
    skipped: false,
  };
}

export async function sendCheckinReminders(options: {
  now?: Date;
  repository?: CheckinRepository;
} = {}): Promise<DispatchSummary> {
  const configuration = getMessagingConfigurationStatus();
  if (!configuration.sendingEnabled || !configuration.readyForProduction) {
    return {
      created: 0,
      sent: 0,
      failed: 0,
      dataQualityCount: 0,
      skipped: true,
      reason: configuration.sendingEnabled ? "ALIMTALK_NOT_READY" : "SENDING_DISABLED",
    };
  }
  const repository = options.repository ?? (await getCheckinRepository());
  const result = await repository.enqueueReminderMessages(options.now ?? new Date());
  return {
    created: result.queued,
    sent: 0,
    failed: 0,
    dataQualityCount: result.dataQualityCount,
    skipped: false,
  };
}
