import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireImportSuperAdmin: vi.fn(),
  previewOperationalDataImport: vi.fn(),
  applyOperationalDataImport: vi.fn(),
}));

vi.mock("@/lib/imports/admin-authorization", () => ({
  requireImportSuperAdmin: mocks.requireImportSuperAdmin,
}));
vi.mock("@/lib/imports/server", () => ({
  previewOperationalDataImport: mocks.previewOperationalDataImport,
  applyOperationalDataImport: mocks.applyOperationalDataImport,
}));

import { POST as confirmImport } from "@/app/api/admin/import/confirm/route";
import { POST as previewImport } from "@/app/api/admin/import/preview/route";

const routes = [
  ["preview", previewImport],
  ["confirm", confirmImport],
] as const;

function streamedRequest(
  path: string,
  chunks: Uint8Array[],
  declaredLength?: string,
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    origin: "https://hometogether.test",
  });
  if (declaredLength !== undefined) headers.set("content-length", declaredLength);
  return new Request(`https://hometogether.test${path}`, {
    method: "POST",
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireImportSuperAdmin.mockResolvedValue({
    userId: "00000000-0000-4000-8000-000000000001",
  });
});

describe.each(routes)("admin import %s body limits", (_name, handler) => {
  const path = `/api/admin/import/${_name}`;

  it("rejects a streamed oversized body without Content-Length", async () => {
    const response = await handler(
      streamedRequest(path, [new Uint8Array(1_300_000), new Uint8Array(1_300_000)]),
    );

    expect(response.status).toBe(413);
    expect(mocks.previewOperationalDataImport).not.toHaveBeenCalled();
    expect(mocks.applyOperationalDataImport).not.toHaveBeenCalled();
  });

  it("rejects actual bytes when Content-Length falsely declares a small body", async () => {
    const response = await handler(
      streamedRequest(
        path,
        [new Uint8Array(1_300_000), new Uint8Array(1_300_000)],
        "2",
      ),
    );

    expect(response.status).toBe(413);
    expect(mocks.previewOperationalDataImport).not.toHaveBeenCalled();
    expect(mocks.applyOperationalDataImport).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 without invoking import planning", async () => {
    const response = await handler(
      streamedRequest(path, [Uint8Array.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])]),
    );

    expect(response.status).toBe(400);
    expect(mocks.previewOperationalDataImport).not.toHaveBeenCalled();
    expect(mocks.applyOperationalDataImport).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without invoking import planning", async () => {
    const response = await handler(
      streamedRequest(path, [new TextEncoder().encode('{"csv":')]),
    );

    expect(response.status).toBe(400);
    expect(mocks.previewOperationalDataImport).not.toHaveBeenCalled();
    expect(mocks.applyOperationalDataImport).not.toHaveBeenCalled();
  });
});
