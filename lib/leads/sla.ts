import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchIntegrationOutbox } from "@/lib/webhooks/dispatch-outbox";

export type LeadSlaRunSummary = {
  queued: number;
  delivered: number;
  failed: number;
  alertDeliveryConfigured: boolean;
};

export async function runLeadSlaAlerts(
  now = new Date(),
): Promise<LeadSlaRunSummary> {
  const { data, error } = await createAdminClient().rpc(
    "queue_lead_sla_alerts",
    {
      p_now: now.toISOString(),
    },
  );
  if (error) throw error;
  const queued = Array.isArray(data) ? data.length : 0;
  const integrations = await dispatchIntegrationOutbox();
  const alert = integrations.adminAlert;
  const delivered =
    "delivered" in alert && typeof alert.delivered === "number"
      ? alert.delivered
      : 0;
  const failed =
    "failed" in alert && typeof alert.failed === "number" ? alert.failed : 0;
  const skipped = "skipped" in alert && alert.skipped === true;
  return {
    queued,
    delivered,
    failed,
    alertDeliveryConfigured: !skipped,
  };
}
