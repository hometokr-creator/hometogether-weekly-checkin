import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { createMessagingProvider } from "@/lib/messaging";
import {
  CallbackBodyError,
  readLimitedCallbackBody,
} from "@/lib/messaging/callback-body";
import { getMessagingConfigurationStatus } from "@/lib/messaging/config";
import { persistMessageDeliveryReceipt } from "@/lib/messaging/delivery-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerNamePattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const context = createRequestContext();
  const provider = (await params).provider.toLowerCase();
  const configuration = getMessagingConfigurationStatus();
  if (
    !providerNamePattern.test(provider) ||
    provider !== configuration.provider ||
    !configuration.callbackConfigured ||
    !configuration.readyForAdminTest
  ) {
    return publicErrorResponse(
      context,
      "CALLBACK_NOT_CONFIGURED",
      "등록되지 않은 callback입니다.",
      404,
    );
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return publicErrorResponse(
      context,
      "UNSUPPORTED_MEDIA_TYPE",
      "JSON callback만 허용됩니다.",
      415,
    );
  }

  try {
    const rawBody = await readLimitedCallbackBody(request);
    const verifier = createMessagingProvider();
    const receipt = await verifier.verifyCallback({ rawBody, headers: request.headers });
    if (!receipt.valid) {
      return publicErrorResponse(
        context,
        receipt.errorCode ?? "INVALID_CALLBACK_SIGNATURE",
        "callback 검증에 실패했습니다.",
        401,
      );
    }
    const persisted = await persistMessageDeliveryReceipt({
      provider,
      rawBody,
      signatureTimestamp: request.headers.get("x-alimtalk-timestamp")!,
      receipt,
    });
    return jsonResponse(context, {
      ok: true,
      duplicate: persisted.duplicate,
      matched: persisted.matched,
      status: persisted.status,
    });
  } catch (error) {
    if (error instanceof CallbackBodyError) {
      const tooLarge = error.code === "BODY_TOO_LARGE";
      return publicErrorResponse(
        context,
        error.code,
        tooLarge ? "callback 본문이 너무 큽니다." : "callback 본문이 올바르지 않습니다.",
        tooLarge ? 413 : 400,
      );
    }
    logSanitizedApiError("alimtalk_callback_failed", context, error);
    return publicErrorResponse(
      context,
      "CALLBACK_PROCESSING_FAILED",
      "callback을 처리하지 못했습니다.",
      500,
    );
  }
}
