import { describe, expect, it, vi } from "vitest";

import { serializeServiceError } from "@/lib/checkin/service";

describe("check-in service error logging", () => {
  it("does not log raw unexpected error details", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "https://hometogether.test/checkin/secretBearerToken_123456789";

    expect(serializeServiceError(new Error(`delivery failed for ${secret}`))).toMatchObject({
      status: 500,
    });

    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain("weekly-checkin.unexpected-service-error");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("delivery failed");
    log.mockRestore();
  });
});
