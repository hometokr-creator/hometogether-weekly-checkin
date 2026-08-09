import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock } = vi.hoisted(() => ({ requireAdminMock: vi.fn() }));

vi.mock("@/lib/auth/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/admin")>();
  return { ...actual, requireAdmin: requireAdminMock };
});

import { AdminAuthorizationError } from "@/lib/auth/admin";
import { POST } from "@/app/api/admin/system/alimtalk-test/route";

function request() {
  return new Request("https://hometogether.test/api/admin/system/alimtalk-test", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://hometogether.test" },
    body: JSON.stringify({ phone: "010-1234-5678" }),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
});

describe("admin Alimtalk test API authorization", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminMock.mockRejectedValue(new AdminAuthorizationError("UNAUTHENTICATED"));
    const response = await POST(request());
    expect(response.status).toBe(401);
  });

  it("requires SUPER_ADMIN even for an authenticated administrator", async () => {
    requireAdminMock.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.test",
      permissions: ["CHECKIN_READ"],
      isDevelopmentBypass: false,
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
  });
});
