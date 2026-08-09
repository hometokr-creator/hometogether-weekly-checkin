import { describe, expect, it } from "vitest";

import { parseAdminManageArguments } from "../../scripts/admin-manage";

describe("administrator lifecycle CLI", () => {
  it("parses a verified-user add command without inventing credentials", () => {
    expect(
      parseAdminManageArguments([
        "add",
        "Target@Example.com",
        "--actor",
        "Actor@Example.com",
        "--permissions",
        "CHECKIN_READ,SAFETY_READ",
      ]),
    ).toEqual({
      command: "add",
      targetEmail: "target@example.com",
      actorEmail: "actor@example.com",
      permissions: ["CHECKIN_READ", "SAFETY_READ"],
      reason: undefined,
    });
  });

  it("requires a reason for deactivation", () => {
    expect(() =>
      parseAdminManageArguments([
        "deactivate",
        "target@example.com",
        "--actor",
        "actor@example.com",
      ]),
    ).toThrow("deactivate requires --reason");
  });

  it("rejects unsupported permissions", () => {
    expect(() =>
      parseAdminManageArguments([
        "update",
        "target@example.com",
        "--actor",
        "actor@example.com",
        "--permissions",
        "OWNER",
      ]),
    ).toThrow("unsupported value");
  });
});
