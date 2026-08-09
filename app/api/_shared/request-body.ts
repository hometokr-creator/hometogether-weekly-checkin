export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("REQUEST_BODY_TOO_LARGE");
    this.name = "RequestBodyTooLargeError";
  }
}

export function hasOversizedDeclaredBody(
  request: Request,
  maxBytes: number,
): boolean {
  const header = request.headers.get("content-length");
  if (!header || !/^\d+$/.test(header)) return false;
  const declaredLength = Number(header);
  return !Number.isSafeInteger(declaredLength) || declaredLength > maxBytes;
}

/** Reads JSON with a real byte cap even when Content-Length is absent. */
export async function readLimitedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (hasOversizedDeclaredBody(request, maxBytes)) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  return JSON.parse(text);
}
