import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809090828_harden_admin_privacy_and_message_receipts.sql",
  ),
  "utf8",
);

describe("admin privacy and message receipt migration", () => {
  it("separates direct contact and export privileges", () => {
    expect(migration).toContain("'CONTACT_READ'");
    expect(migration).toContain("'DATA_EXPORT'");
    expect(migration).toContain("public.is_admin('CONTACT_READ')");
    expect(migration).toContain("public.is_admin('DATA_EXPORT')");
    expect(migration).toMatch(
      /weekly_responses_select_export_admin[\s\S]*?public\.is_admin\('DATA_EXPORT'\)[\s\S]*?public\.is_admin\('SAFETY_READ'\)/,
    );
    expect(migration).toMatch(
      /weekly_issues_select_export_admin[\s\S]*?public\.is_admin\('DATA_EXPORT'\)[\s\S]*?public\.is_admin\('SAFETY_READ'\)/,
    );
    expect(migration).not.toMatch(
      /profiles_select_self_or_contact_admin[\s\S]{0,250}CHECKIN_READ/,
    );
    expect(
      migration.match(/coalesce\(\(select auth\.jwt\(\)->>'aal'\), 'aal1'\) = 'aal2'/g),
    ).toHaveLength(6);
    expect(migration).toMatch(
      /message_logs_select_authorized_admin[\s\S]*?delivery_scope = 'ADMIN_TEST'[\s\S]*?public\.is_admin\('SUPER_ADMIN'\)[\s\S]*?'aal2'/,
    );
  });

  it("stores no raw callback body and deduplicates provider events", () => {
    expect(migration).toContain("message_delivery_receipts");
    expect(migration).toContain("unique (provider, provider_event_id)");
    expect(migration).toContain("payload_sha256");
    expect(migration).not.toMatch(/raw_(body|payload)\s+text/i);
    expect(migration).toContain("message_delivery_receipts_message_log_id_idx");
    expect(migration).toContain("message_delivery_event_conflict");
    expect(migration).toMatch(
      /v_existing_receipt\.payload_sha256 <> p_payload_sha256/,
    );
  });

  it("uses a monotonic terminal delivery transition", () => {
    expect(migration).toContain("when p_current in ('DELIVERED', 'FAILED') then p_current");
    expect(migration).toContain("message_logs_provider_message_unique_idx");
    expect(migration).toContain("apply_message_delivery_receipt");
    expect(migration).toMatch(
      /revoke all on function public\.apply_message_delivery_receipt[\s\S]*?from public, anon, authenticated;/,
    );
    expect(migration).toContain(
      "grant select on table public.message_delivery_receipts to service_role",
    );
    expect(migration).not.toContain(
      "grant all on table public.message_delivery_receipts to service_role",
    );
    expect(migration).toContain("message_logs_delivery_queue_consistency_check");
    expect(migration).toMatch(
      /delivery_status in \('ACCEPTED', 'SENT', 'DELIVERED'\)[\s\S]*?status = 'SENT'/,
    );
    expect(migration).toMatch(
      /v_log\.status = 'SENT'[\s\S]*?then 'SENT'[\s\S]*?v_log\.status = 'RETRYABLE'[\s\S]*?then 'PENDING'/,
    );
  });

  it("serializes send acceptance and a racing provider callback", () => {
    const lockKey =
      "'hometogether-message-delivery:' ||";
    expect(migration.split(lockKey)).toHaveLength(3);
    expect(migration).toMatch(
      /complete_message_delivery[\s\S]*?pg_advisory_xact_lock[\s\S]*?select \* into v_log[\s\S]*?for update/,
    );
    expect(migration).toMatch(
      /apply_message_delivery_receipt[\s\S]*?pg_advisory_xact_lock[\s\S]*?select \* into v_message[\s\S]*?for update/,
    );
  });
});
