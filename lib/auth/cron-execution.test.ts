import { describe, expect, it } from "vitest";

import { safeCronErrorCode } from "@/lib/auth/cron-execution";

describe("safeCronErrorCode", () => {
  it("uses an operational code without persisting an error message", () => {
    expect(
      safeCronErrorCode({ code: "23505", message: "secret and answer text" }),
    ).toBe("23505");
  });

  it("falls back to the error class instead of its potentially sensitive message", () => {
    const error = new TypeError("token=https://example.test/checkin/private-token");
    expect(safeCronErrorCode(error)).toBe("TypeError");
  });

  it("rejects free-form values masquerading as error codes", () => {
    expect(safeCronErrorCode({ code: "phone +821012345678" })).toBe(
      "UNCLASSIFIED_ERROR",
    );
  });
});
