import {
  createRequestContext,
  jsonResponse,
  publicErrorResponse,
  serviceErrorResponse,
} from "@/app/api/_shared/responses";
import { consumeCheckinRateLimit, extractClientAddress } from "@/lib/checkin/rate-limit";
import { getPublicCheckin } from "@/lib/checkin/service";
import { hashToken, isUsableTokenFormat } from "@/lib/checkin/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const context = createRequestContext({ "referrer-policy": "no-referrer" });
  const { token } = await params;
  if (!isUsableTokenFormat(token)) {
    return publicErrorResponse(
      context,
      "NOT_FOUND",
      "체크인 링크를 찾을 수 없습니다.",
      404,
    );
  }

  const allowed = await consumeCheckinRateLimit({
    tokenHash: hashToken(token),
    clientAddress: extractClientAddress(request.headers),
    scope: "lookup",
    limit: 20,
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

  try {
    const invitation = await getPublicCheckin(token);
    return jsonResponse(context, { invitation });
  } catch (error) {
    return serviceErrorResponse(context, error);
  }
}
