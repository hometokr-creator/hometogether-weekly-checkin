import {
  createRequestContext,
  jsonResponse,
  publicErrorResponse,
  serviceErrorResponse,
} from "@/app/api/_shared/responses";
import { consumeCheckinRateLimit, extractClientAddress } from "@/lib/checkin/rate-limit";
import { submitCheckin } from "@/lib/checkin/service";
import { hashToken, isUsableTokenFormat } from "@/lib/checkin/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const context = createRequestContext({ "referrer-policy": "no-referrer" });
  const { token } = await params;
  if (!isUsableTokenFormat(token)) {
    return publicErrorResponse(context, "NOT_FOUND", "체크인 링크를 찾을 수 없습니다.", 404);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 256_000) {
    return publicErrorResponse(
      context,
      "PAYLOAD_TOO_LARGE",
      "답변 크기가 너무 큽니다.",
      413,
    );
  }

  const allowed = await consumeCheckinRateLimit({
    tokenHash: hashToken(token),
    clientAddress: extractClientAddress(request.headers),
    scope: "submit",
    limit: 10,
    windowSeconds: 60,
  });
  if (!allowed) {
    return publicErrorResponse(
      context,
      "RATE_LIMITED",
      "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      429,
      { "retry-after": "60" },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return publicErrorResponse(
      context,
      "INVALID_SUBMISSION",
      "답변 형식을 확인해 주세요.",
      400,
    );
  }

  try {
    const result = await submitCheckin(token, raw);
    return jsonResponse(context, result);
  } catch (error) {
    return serviceErrorResponse(context, error);
  }
}
