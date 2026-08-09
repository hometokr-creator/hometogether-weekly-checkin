import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809015136_harden_touch_updated_at_search_path.sql",
  ),
  "utf8",
);
const legacyFilesMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809015353_harden_legacy_app_files_rls.sql",
  ),
  "utf8",
);
const productionValidation = readFileSync(
  join(process.cwd(), "scripts/production-validation/lib.ts"),
  "utf8",
);
const legacyMemberMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260809020242_harden_legacy_member_helpers.sql",
  ),
  "utf8",
);

describe("security advisor hardening migration", () => {
  it("pins the legacy trigger search path without requiring the legacy schema", () => {
    expect(migration).toContain("to_regprocedure('public.touch_updated_at()')");
    expect(migration).toContain(
      "alter function public.touch_updated_at() set search_path = pg_catalog, public",
    );
    expect(migration).toContain(
      "revoke execute on function public.touch_updated_at() from public, anon, authenticated",
    );
  });

  it("makes future Data API objects fail closed by default", () => {
    expect(migration).toContain(
      "alter default privileges for role postgres in schema public",
    );
    expect(migration).toContain(
      "revoke all privileges on tables from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all privileges on sequences from anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all privileges on functions from public, anon, authenticated",
    );
  });

  it("caches auth.uid for the two weekly-checkin self-read policies", () => {
    expect(migration).toContain("drop policy if exists profiles_select_self_or_admin");
    expect(migration).toContain("auth_user_id = (select auth.uid())");
    expect(migration).toContain("drop policy if exists admin_memberships_select_self");
    expect(migration).toContain("user_id = (select auth.uid())");
  });
});

describe("legacy app files RLS hardening migration", () => {
  it("removes the unrestricted policy and denies anonymous table access", () => {
    expect(legacyFilesMigration).toContain(
      'drop policy if exists "app files delete for active members"',
    );
    expect(legacyFilesMigration).toContain(
      "revoke all privileges on table public.app_files from anon",
    );
    expect(legacyFilesMigration).not.toMatch(/for all to public/i);
  });

  it("limits reads to members and writes to editors or admins", () => {
    expect(legacyFilesMigration).toContain(
      "for select to authenticated\n      using (public.is_app_member((select auth.uid())))",
    );
    expect(legacyFilesMigration).toContain(
      "for delete to authenticated\n      using (public.can_edit_app((select auth.uid())))",
    );
    expect(legacyFilesMigration).toContain(
      "grant select, insert, update, delete on table public.app_files to authenticated",
    );
  });

  it("is replayable when the separate legacy schema is absent", () => {
    expect(legacyFilesMigration).toContain("to_regclass('public.app_files') is null");
    expect(legacyFilesMigration).toContain("LEGACY_APP_FILES_RLS_PRECONDITION_FAILED");
  });

  it("requires an anonymous table-level denial even while app_files is empty", () => {
    expect(productionValidation).toContain(
      '{ table: "app_files", requireGrantDenied: true }',
    );
    expect(productionValidation).toContain(
      "anonymous SELECT grant가 회수되지 않았습니다",
    );
  });
});

describe("legacy member helper hardening migration", () => {
  it("removes anonymous legacy grants while retaining signed-in access", () => {
    expect(legacyMemberMigration).toContain(
      "revoke all privileges on table public.app_members from anon",
    );
    expect(legacyMemberMigration).toContain(
      "revoke all privileges on table public.app_records from anon",
    );
    expect(legacyMemberMigration).toContain(
      "grant select on table public.app_members to authenticated",
    );
    expect(legacyMemberMigration).toContain(
      "grant select, insert, update, delete on table public.app_records to authenticated",
    );
  });

  it("keeps helper RPCs signed-in and service-only", () => {
    expect(legacyMemberMigration).toContain(
      "revoke execute on function public.is_app_member(uuid) from public, anon",
    );
    expect(legacyMemberMigration).toContain(
      "revoke execute on function public.can_edit_app(uuid) from public, anon",
    );
    expect(legacyMemberMigration).toContain(
      "to authenticated, service_role",
    );
  });

  it("splits record writes by operation and adds the missing FK indexes", () => {
    expect(legacyMemberMigration).not.toMatch(/for all to (?:public|authenticated)/i);
    expect(legacyMemberMigration).toContain("for insert to authenticated");
    expect(legacyMemberMigration).toContain("for update to authenticated");
    expect(legacyMemberMigration).toContain("for delete to authenticated");
    expect(legacyMemberMigration).toContain("app_files_created_by_idx");
    expect(legacyMemberMigration).toContain("app_records_created_by_idx");
    expect(legacyMemberMigration).toContain("app_records_updated_by_idx");
    expect(legacyMemberMigration).toContain(
      "student_email_verifications_university_id_idx",
    );
  });
});
