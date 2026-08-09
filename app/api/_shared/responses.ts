import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { AdminAuthorizationError } from "@/lib/auth/admin";
import { CheckinServiceError } from "@/lib/checkin/service";

export type RequestContext = {
  requestId: string;
  headers: Record<string, string>;
};

export function createRequestContext(
  headers: Record<string, string> = {},
): RequestContext {
  const requestId = randomUUID();
  return {
    requestId,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-request-id": requestId,
      ...headers,
    },
  };
}

export function jsonResponse(
  context: RequestContext,
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: { ...context.headers, ...headers },
  });
}

export function publicErrorResponse(
  context: RequestContext,
  code: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
) {
  return jsonResponse(
    context,
    { error: code, message, requestId: context.requestId },
    status,
    headers,
  );
}

function safeErrorName(error: unknown): string {
  if (error instanceof Error) return error.name.slice(0, 80);
  return "UnknownError";
}

/**
 * Logs only a correlation ID and an error class. Database messages can contain
 * table values, so the raw error, message and stack are deliberately omitted.
 */
export function logSanitizedApiError(
  event: string,
  context: RequestContext,
  error: unknown,
) {
  console.error(
    JSON.stringify({
      event,
      requestId: context.requestId,
      errorName: safeErrorName(error),
    }),
  );
}

export function serviceErrorResponse(
  context: RequestContext,
  error: unknown,
) {
  if (error instanceof CheckinServiceError) {
    return publicErrorResponse(
      context,
      error.code,
      error.userMessage,
      error.status,
    );
  }

  logSanitizedApiError("weekly_checkin_api_failed", context, error);
  return publicErrorResponse(
    context,
    "INTERNAL_ERROR",
    "잠시 후 다시 시도해 주세요.",
    500,
  );
}

export function adminAuthorizationErrorResponse(
  context: RequestContext,
  error: unknown,
) {
  if (!(error instanceof AdminAuthorizationError)) return null;

  const message = {
    UNAUTHENTICATED: "관리자 로그인이 필요합니다.",
    FORBIDDEN: "이 작업을 수행할 관리자 권한이 없습니다.",
    MFA_REQUIRED: "이 작업을 수행하려면 관리자 MFA 인증을 완료해야 합니다.",
    MISCONFIGURED: "관리자 인증 설정을 확인해 주세요.",
  }[error.code];

  return publicErrorResponse(context, error.code, message, error.status);
}
