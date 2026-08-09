import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260807072605_message_outbox_operational.sql"),
  "utf8",
);

describe("operational message outbox migration", () => {
  it("keeps QA suppression and requires explicit sending gates", () => {
    expect(migration).toContain("and not invitation.is_test");
    expect(migration).toContain("p_allow_production boolean default false");
    expect(migration).toContain("p_allow_admin_test boolean default false");
    expect(migration).toContain("delivery_scope in ('PRODUCTION', 'ADMIN_TEST')");
  });

  it("atomically leases rows and enforces the retry ceiling in the database", () => {
    expect(migration).toContain("for update of message skip locked");
    expect(migration).toContain("message.attempt_count < message.max_attempts");
    expect(migration).toContain("v_log.attempt_count < v_log.max_attempts");
    expect(migration).toContain("max_attempts integer not null default 5");
    expect(migration).toMatch(
      /when p_success then 'SENT'\s+when v_can_retry then 'PENDING'\s+else 'FAILED'/,
    );
  });

  it("keeps admin tests separate and auditable", () => {
    expect(migration).toContain("'ALIMTALK_TEST'");
    expect(migration).toContain("'ALIMTALK_TEST_ENQUEUED'");
    expect(migration).toContain("'CANCELLED'");
    expect(migration).not.toMatch(/after_json[\s\S]{0,250}p_recipient_phone/);
  });

  it("revalidates current production eligibility and cancels stale work", () => {
    expect(migration).toContain("is_weekly_invitation_currently_eligible");
    expect(migration).toContain("profile.notification_enabled");
    expect(migration).toContain("profile.phone ~ '^\\+8210[0-9]{8}$'");
    expect(migration).toContain("match.status = 'ACTIVE'");
    expect(migration).toContain("home.is_active");
    expect(migration).toContain("set status = 'CANCELLED'");
    expect(migration).toContain("RECIPIENT_NO_LONGER_ELIGIBLE");
  });

  it("keeps bearer URLs and production phone snapshots out of message logs", () => {
    expect(migration).toContain("message_logs_no_raw_checkin_url_check");
    expect(migration).toContain("p_template_variables - 'checkinUrl' - 'checkin_url'");
    expect(migration).toContain("message_logs_production_phone_not_stored_check");
    expect(migration).toContain("delivery_scope <> 'PRODUCTION' or recipient_phone is null");
  });

  it("limits sensitive admin-test rows and the eligibility helper to privileged roles", () => {
    expect(migration).toContain("delivery_scope = 'PRODUCTION' and public.is_admin('CHECKIN_READ')");
    expect(migration).toContain("delivery_scope = 'ADMIN_TEST' and public.is_admin('SUPER_ADMIN')");
    expect(migration).toMatch(
      /revoke all on function public\.is_weekly_invitation_currently_eligible\([\s\S]*?from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.is_weekly_invitation_currently_eligible\([\s\S]*?to service_role;/,
    );
  });
});
