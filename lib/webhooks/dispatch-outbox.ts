import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { hasSupabaseServerConfig } from "@/lib/checkin/repository-factory";
import { classifyHttpFailure, retryDelayMs } from "@/lib/messaging/provider";
import { createAdminClient } from "@/lib/supabase/admin";

type Destination = "CRM" | "ADMIN_ALERT";
type OutboxRow = {
  id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempt_count: number;
};

function destinationConfig(destination: Destination) {
  if (destination === "CRM") {
    return {
      url: process.env.CRM_WEBHOOK_URL,
      secret: process.env.CRM_WEBHOOK_SIGNING_SECRET,
    };
  }
  return {
    url: process.env.ADMIN_ALERT_WEBHOOK_URL,
    secret:
      process.env.ADMIN_ALERT_WEBHOOK_SIGNING_SECRET ?? process.env.CRM_WEBHOOK_SIGNING_SECRET,
  };
}

function sign(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

function safeError(error: unknown) {
  const name = error instanceof Error && error.name ? error.name : "UnknownError";
  return `Webhook delivery exception: ${name}`.slice(0, 120);
}

async function deliverDestination(destination: Destination) {
  const config = destinationConfig(destination);
  if (!config.url || !config.secret) return { claimed: 0, delivered: 0, failed: 0, skipped: true };
  const supabase = createAdminClient();
  const leaseOwner = `outbox-${randomUUID()}`;
  const { data, error } = await supabase.rpc("claim_outbox_events", {
    p_destination: destination,
    p_lease_owner: leaseOwner,
    p_limit: 25,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  const events = (data ?? []) as OutboxRow[];
  let delivered = 0;
  let failed = 0;

  for (const event of events) {
    // Production QA events must never reach real CRM or emergency-alert
    // destinations. SQL normally suppresses these rows; this is a second,
    // independent guard for older rows or partially rolled-out migrations.
    if (event.payload.isTest === true || event.payload.is_test === true) {
      const { error: skipError } = await supabase.rpc("complete_outbox_event", {
        p_outbox_id: event.id,
        p_lease_owner: leaseOwner,
        p_success: true,
        p_http_status: null,
        p_error_sanitized: null,
        p_retryable: false,
        p_next_attempt_at: null,
      });
      if (skipError) throw skipError;
      delivered += 1;
      continue;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: event.event_id,
      type: event.event_type,
      occurredAt: event.created_at,
      data: event.payload,
    });
    let success = false;
    let httpStatus: number | null = null;
    let errorMessage: string | null = null;
    let retryable = false;
    let failureClass: "TRANSIENT" | "PERMANENT" | "UNKNOWN" | null = null;
    let providerRetryAfter: number | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hometogether-event-id": event.event_id,
          "x-hometogether-timestamp": timestamp,
          "x-hometogether-signature": sign(config.secret, timestamp, body),
        },
        body,
        signal: controller.signal,
      });
      httpStatus = response.status;
      success = response.ok;
      failureClass = classifyHttpFailure(response.status);
      retryable = !success && failureClass === "TRANSIENT";
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) providerRetryAfter = retryAfter;
      if (!response.ok) errorMessage = `Webhook returned HTTP ${response.status}`;
    } catch (deliveryError) {
      retryable = true;
      failureClass = "TRANSIENT";
      errorMessage = safeError(deliveryError);
    } finally {
      clearTimeout(timeout);
    }

    const { error: completeError } = await supabase.rpc("complete_outbox_event", {
      p_outbox_id: event.id,
      p_lease_owner: leaseOwner,
      p_success: success,
      p_http_status: httpStatus,
      p_error_sanitized: errorMessage,
      p_retryable: retryable,
      p_next_attempt_at: retryable
        ? new Date(
            Date.now() + retryDelayMs(event.attempt_count, providerRetryAfter),
          ).toISOString()
        : null,
      p_failure_class: success ? null : failureClass ?? "PERMANENT",
    });
    if (completeError) throw completeError;
    if (success) delivered += 1;
    else failed += 1;
  }
  return { claimed: events.length, delivered, failed, skipped: false };
}

export async function dispatchIntegrationOutbox() {
  if (!hasSupabaseServerConfig()) {
    return { crm: { claimed: 0 }, adminAlert: { claimed: 0 } };
  }
  const [crm, adminAlert] = await Promise.all([
    deliverDestination("CRM"),
    deliverDestination("ADMIN_ALERT"),
  ]);
  return { crm, adminAlert };
}
