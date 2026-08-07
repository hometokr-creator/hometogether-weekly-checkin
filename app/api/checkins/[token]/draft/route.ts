import {
  createRequestContext,
  jsonResponse,
  publicErrorResponse,
  serviceErrorResponse,
} from "@/app/api/_shared/responses";
import { consumeCheckinRateLimit, extractClientAddress } from "@/lib/checkin/rate-limit";
import { saveCheckinDraft } from "@/lib/checkin/service";
import { hashToken, isUsableTokenFormat } from "@/lib/checkin/token";
import { draftSchema } from "@/lib/checkin/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const context = createRequestContext({ "referrer-policy": "no-referrer" });
  const { token } = await params;
  if (!isUsableTokenFormat(token)) {
    return publicErrorResponse(context, "NOT_FOUND", "체크인 링크를 찾을 수 없습니다.", 404);
  }

  const allowed = await consumeCheckinRateLimit({
    tokenHash: hashToken(token),
    clientAddress: extractClientAddress(request.headers),
    scope: "draft",
    limit: 60,
    windowSeconds: 60,
  });
  if (!allowed) {
    return publicErrorResponse(
      context,
      "RATE_LIMITED",
      "잠시 후 다시 시도해 주세요.",
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
      "INVALID_DRAFT",
      "임시 답변을 저장하지 못했습니다.",
      400,
    );
  }

  try {
    const parsed = draftSchema.safeParse(raw);
    if (!parsed.success) {
      return publicErrorResponse(
        context,
        "INVALID_DRAFT",
        "임시 답변을 저장하지 못했습니다.",
        400,
      );
    }
    const invitation = await saveCheckinDraft(token, parsed.data.answers);
    return jsonResponse(context, { saved: true, status: invitation.status });
  } catch (error) {
    return serviceErrorResponse(context, error);
  }
}
