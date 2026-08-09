export class CallbackBodyError extends Error {
  constructor(readonly code: "BODY_TOO_LARGE" | "INVALID_UTF8" | "EMPTY_BODY") {
    super(code);
    this.name = "CallbackBodyError";
  }
}
/** Reads the exact signed bytes with a hard cap independent of Content-Length. */
export async function readLimitedCallbackBody(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new CallbackBodyError("BODY_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new CallbackBodyError("EMPTY_BODY");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new CallbackBodyError("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  if (total === 0) throw new CallbackBodyError("EMPTY_BODY");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CallbackBodyError("INVALID_UTF8");
  }
}
