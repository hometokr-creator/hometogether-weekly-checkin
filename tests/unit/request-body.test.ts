import { describe, expect, it } from "vitest";

import {
  hasOversizedDeclaredBody,
  readLimitedJson,
  RequestBodyTooLargeError,
} from "@/app/api/_shared/request-body";

describe("readLimitedJson", () => {
  it("parses a bounded UTF-8 JSON request", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ message: "안녕하세요" }),
    });
    await expect(readLimitedJson(request, 1_024)).resolves.toEqual({
      message: "안녕하세요",
    });
  });

  it("rejects a streamed body that exceeds the cap without Content-Length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":"'));
          controller.enqueue(new TextEncoder().encode("x".repeat(100)));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readLimitedJson(request, 32)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("rejects an oversized declared Content-Length before reading", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "9999" },
      body: "{}",
    });
    await expect(readLimitedJson(request, 64)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
    expect(hasOversizedDeclaredBody(request, 64)).toBe(true);
    expect(
      hasOversizedDeclaredBody(
        new Request("https://example.test", {
          method: "POST",
          headers: { "content-length": "999999999999999999999999999999" },
          body: "{}",
        }),
        64,
      ),
    ).toBe(true);
  });
});
