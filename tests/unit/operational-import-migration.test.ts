import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260807072611_operational_data_import.sql"),
  "utf8",
);

describe("operational import migration safety", () => {
  it("does not mutate the legacy app tables", () => {
    expect(migration).not.toMatch(/(?:alter|drop|truncate|delete\s+from)\s+(?:table\s+)?public\.app_/i);
  });

  it("keeps apply and staging cleanup service-role only", () => {
    expect(migration).toContain("public.apply_operational_data_import");
    expect(migration).toContain("public.purge_expired_data_import_staging");
    expect(migration).toMatch(/apply_operational_data_import[\s\S]+from public, anon, authenticated/i);
    expect(migration).toMatch(/admin_has_permission\(p_admin_id, 'SUPER_ADMIN'\)/);
  });

  it("revalidates strict eligibility and rejects ambiguous active matches", () => {
    expect(migration).toContain("where match.status = 'ACTIVE'");
    expect(migration).toContain("home.is_active");
    expect(migration).toContain("profile.notification_enabled");
    expect(migration).toContain("authoritative_match_counts");
    expect(migration).toContain("match_count.eligible_match_count = 1");
    expect(migration).toContain("eligible_match_count = 1");
    expect(migration).toContain("on conflict (run_id, participant_id) do nothing");
    expect(migration).toContain("invitation.match_id::text || ':initial'");
  });
});
