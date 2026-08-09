import {
  createRequestContext,
  jsonResponse,
  publicErrorResponse,
  serviceErrorResponse,
} from "@/app/api/_shared/responses";
import {
  hasOversizedDeclaredBody,
  readLimitedJson,
  RequestBodyTooLargeError,
} from "@/app/api/_shared/request-body";
import {
  consumeCheckinRateLimit,
  consumePublicIpRateLimit,
  extractClientAddress,
} from "@/lib/checkin/rate-limit";
import { assertPublicCheckinToken, submitCheckin } from "@/lib/checkin/service";
import { hashToken, isUsableTokenFormat } from "@/lib/checkin/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_SUBMISSION_BYTES = 256_000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const context = createRequestContext({ "referrer-policy": "no-referrer" });
  const { token } = await params;
  if (hasOversizedDeclaredBody(request, MAX_SUBMISSION_BYTES)) {
    return publicErrorResponse(
      context,
      "PAYLOAD_TOO_LARGE",
      "답변 크기가 너무 큽니다.",
      413,
    );
  }

  const clientAddress = extractClientAddress(request.headers, request.url);
  let ipAllowed: boolean;
  try {
    ipAllowed = await consumePublicIpRateLimit({
      clientAddress,
      scope: "submit",
      limit: 30,
      windowSeconds: 60,
    });
  } catch (error) {
    return serviceErrorResponse(context, error);
  }
  if (!ipAllowed) {
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
    raw = await readLimitedJson(request, MAX_SUBMISSION_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return publicErrorResponse(
        context,
        "PAYLOAD_TOO_LARGE",
        "답변 크기가 너무 큽니다.",
        413,
      );
    }
    return publicErrorResponse(
      context,
      "INVALID_SUBMISSION",
      "답변 형식을 확인해 주세요.",
      400,
    );
  }

  if (!isUsableTokenFormat(token)) {
    return publicErrorResponse(context, "NOT_FOUND", "체크인 링크를 찾을 수 없습니다.", 404);
  }

  try {
    await assertPublicCheckinToken(token);
    const tokenAllowed = await consumeCheckinRateLimit({
      tokenHash: hashToken(token),
      clientAddress,
      scope: "submit",
      limit: 10,
      windowSeconds: 60,
    });
    if (!tokenAllowed) {
      return publicErrorResponse(
        context,
        "RATE_LIMITED",
        "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
        429,
        { "retry-after": "60" },
      );
    }

    const result = await submitCheckin(token, raw);
    return jsonResponse(context, result);
  } catch (error) {
    return serviceErrorResponse(context, error);
  }
}
