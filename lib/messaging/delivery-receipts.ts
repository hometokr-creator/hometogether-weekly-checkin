import "server-only";

import { createHash } from "node:crypto";

import type {
  MessageDeliveryStatus,
  MessagingCallbackResult,
} from "@/lib/messaging/provider";
import { createAdminClient } from "@/lib/supabase/admin";

export type DeliveryReceiptResult = {
  duplicate: boolean;
  matched: boolean;
  status: MessageDeliveryStatus;
};

export async function persistMessageDeliveryReceipt(options: {
  provider: string;
  rawBody: string;
  signatureTimestamp: string;
  receipt: MessagingCallbackResult;
}): Promise<DeliveryReceiptResult> {
  const { receipt } = options;
  if (
    !receipt.valid ||
    !receipt.providerEventId ||
    !receipt.providerMessageId ||
    !receipt.status
  ) {
    throw new Error("VERIFIED_DELIVERY_RECEIPT_REQUIRED");
  }
  const payloadSha256 = createHash("sha256").update(options.rawBody).digest("hex");
  const { data, error } = await createAdminClient().rpc(
    "apply_message_delivery_receipt",
    {
      p_provider: options.provider,
      p_provider_event_id: receipt.providerEventId,
      p_provider_message_id: receipt.providerMessageId,
      p_delivery_status: receipt.status,
      p_occurred_at: receipt.occurredAt ?? null,
      p_signature_timestamp: new Date(
        Number(options.signatureTimestamp) * 1000,
      ).toISOString(),
      p_payload_sha256: payloadSha256,
      p_error_code: receipt.errorCode ?? null,
    },
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("DELIVERY_RECEIPT_RESULT_MISSING");
  }
  const result = row as Record<string, unknown>;
  return {
    duplicate: result.duplicate === true,
    matched: result.matched === true,
    status: String(result.delivery_status ?? receipt.status) as MessageDeliveryStatus,
  };
}
