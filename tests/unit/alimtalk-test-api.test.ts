import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminAal2Mock, configurationMock } = vi.hoisted(() => ({
  requireAdminAal2Mock: vi.fn(),
  configurationMock: vi.fn(),
}));

vi.mock("@/lib/auth/admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/admin")>();
  return { ...actual, requireAdminAal2: requireAdminAal2Mock };
});

vi.mock("@/lib/messaging/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messaging/config")>();
  return { ...actual, getMessagingConfigurationStatus: configurationMock };
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
  requireAdminAal2Mock.mockReset();
  configurationMock.mockReset();
  configurationMock.mockReturnValue({ readyForAdminTest: false });
});

describe("admin Alimtalk test API authorization", () => {
  it("rejects an unauthenticated request", async () => {
    requireAdminAal2Mock.mockRejectedValue(new AdminAuthorizationError("UNAUTHENTICATED"));
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(configurationMock).not.toHaveBeenCalled();
  });

  it("requires SUPER_ADMIN even for an authenticated administrator", async () => {
    requireAdminAal2Mock.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.test",
      permissions: ["CHECKIN_READ"],
      isDevelopmentBypass: false,
    });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(configurationMock).not.toHaveBeenCalled();
  });

  it("fails closed after authorization when callback readiness is incomplete", async () => {
    requireAdminAal2Mock.mockResolvedValue({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.test",
      permissions: ["SUPER_ADMIN"],
      isDevelopmentBypass: false,
    });
    configurationMock.mockReturnValue({ readyForAdminTest: false });

    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(requireAdminAal2Mock).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(configurationMock).toHaveBeenCalledOnce();
  });
});
