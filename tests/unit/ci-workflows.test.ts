import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ci = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
const productionValidation = readFileSync(
  join(process.cwd(), ".github/workflows/production-validation.yml"),
  "utf8",
);

function namedStep(source: string, name: string): string {
  const start = source.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`Workflow step is missing: ${name}`);
  const next = source.indexOf("\n      - name:", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("GitHub Actions workflows", () => {
  it("runs every repository quality gate without Production credentials", () => {
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm repository:safety",
      "pnpm migrations:validate",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test",
      "pnpm test:integration",
      "pnpm build",
      "pnpm audit --prod",
      "supabase db reset --local",
      "supabase db lint --local --fail-on error",
      "supabase test db --local supabase/tests/admin_privacy_rls.sql",
    ]) {
      expect(ci).toContain(command);
    }
    expect(ci).not.toContain("secrets.");
    expect(ci).toContain("git /repo");
    expect(ci).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(ci).not.toContain("git --source=");
  });

  it("injects Production secrets only into validation commands", () => {
    const beforeSteps = productionValidation.slice(
      productionValidation.indexOf("jobs:"),
      productionValidation.indexOf("    steps:"),
    );
    expect(beforeSteps).not.toContain("secrets.");
    expect(namedStep(productionValidation, "Install locked dependencies")).not.toContain(
      "secrets.",
    );
    expect(
      namedStep(productionValidation, "Install Chromium for isolated fixture validation"),
    ).not.toContain("secrets.");
    expect(namedStep(productionValidation, "Read-only Production preflight")).toContain(
      "secrets.SUPABASE_SECRET_KEY",
    );
    expect(
      namedStep(productionValidation, "Run isolated Production fixture validation"),
    ).toContain("secrets.SUPABASE_SECRET_KEY");
    expect(
      namedStep(productionValidation, "Clean up exact-ID isolated fixtures"),
    ).toContain("PRODUCTION_VALIDATION_ACK: ${{ inputs.confirm_test_writes }}");
  });
});
