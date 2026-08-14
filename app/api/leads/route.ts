import { z } from "zod";

import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { createPublicLeadToken } from "@/lib/leads/public-token";
import { isPublicLeadRequestAllowed } from "@/lib/leads/rate-limit";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceSchema = z.enum([
  "KAKAO",
  "EVERYTIME",
  "INSTAGRAM",
  "WEBSITE",
  "REFERRAL",
  "ETC",
]);
const customerTypeSchema = z.enum([
  "GUEST",
  "HOST",
  "GUEST_PARENT",
  "HOST_CHILD",
  "UNKNOWN",
]);

const createLeadSchema = z.object({
  customerLabel: z.string().trim().min(1).max(120).optional(),
  customerType: customerTypeSchema.optional(),
  customerTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  source: sourceSchema,
  sourceDetail: z.string().trim().max(500).optional(),
  utm: z
    .object({
      source: z.string().trim().max(200).optional(),
      medium: z.string().trim().max(200).optional(),
      campaign: z.string().trim().max(200).optional(),
      term: z.string().trim().max(200).optional(),
      content: z.string().trim().max(200).optional(),
    })
    .optional(),
  landingPath: z.string().trim().max(1000).optional(),
  desiredRegion: z.string().trim().max(200).optional(),
  desiredMoveIn: z.iso.date().optional(),
  desiredTermMonths: z.number().int().min(1).max(120).optional(),
  budgetMonthly: z.number().int().min(0).max(100_000_000).optional(),
  budgetDeposit: z.number().int().min(0).max(1_000_000_000).optional(),
  mustHave: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  originalListingId: z.uuid().optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  const context = createRequestContext({ pragma: "no-cache" });
  if (!isAllowedOrigin(request)) {
    return publicErrorResponse(
      context,
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403,
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return publicErrorResponse(
      context,
      "PAYLOAD_TOO_LARGE",
      "문의 입력 크기가 너무 큽니다.",
      413,
    );
  }
  try {
    if (!(await isPublicLeadRequestAllowed(request, "/api/leads", 10))) {
      return publicErrorResponse(
        context,
        "RATE_LIMITED",
        "잠시 후 다시 시도해 주세요.",
        429,
      );
    }
    const parsed = createLeadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return publicErrorResponse(
        context,
        "INVALID_BODY",
        "문의 정보를 확인해 주세요.",
        400,
      );
    }
    // Fail before the row is written when the production token secret is absent.
    const tokenPlaceholder = createPublicLeadToken(
      "00000000-0000-0000-0000-000000000000",
    );
    if (!tokenPlaceholder) {
      return publicErrorResponse(
        context,
        "LEAD_TOKEN_UNAVAILABLE",
        "문의 연결을 준비하지 못했습니다.",
        503,
      );
    }
    const lead = await (await getLeadRepository()).createLead(parsed.data);
    return jsonResponse(
      context,
      { ok: true, leadId: lead.id, leadToken: createPublicLeadToken(lead.id) },
      201,
    );
  } catch (error) {
    logSanitizedApiError("public_lead_create_failed", context, error);
    return publicErrorResponse(
      context,
      "LEAD_CREATE_FAILED",
      "문의 연결을 준비하지 못했습니다.",
      500,
    );
  }
}
