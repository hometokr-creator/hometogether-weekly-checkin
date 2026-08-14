import { z } from "zod";

import {
  adminAuthorizationErrorResponse,
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { requireAdminAal2 } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableBoolean = z.boolean().nullable().optional();
const nullableAmount = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000)
  .nullable()
  .optional();
const listingSchema = z.object({
  transferRegistrationAvailable: nullableBoolean,
  minimumTermMonths: z.number().int().min(1).max(120).nullable().optional(),
  monthlyPrice1: nullableAmount,
  monthlyPrice3: nullableAmount,
  monthlyPrice4: nullableAmount,
  monthlyPrice6: nullableAmount,
  depositAmount: nullableAmount,
  managementFeeAmount: nullableAmount,
  kitchenAvailable: nullableBoolean,
  curfew: z.string().trim().min(1).max(120).nullable().optional(),
  airConditionerAvailable: nullableBoolean,
  bathroomType: z.string().trim().min(1).max(120).nullable().optional(),
  otherFamilyMembersLive: nullableBoolean,
  hostGender: z
    .enum(["FEMALE", "MALE", "MIXED", "OTHER", "UNSPECIFIED"])
    .nullable()
    .optional(),
  hostIntroduction: z.string().trim().min(1).max(2_000).nullable().optional(),
  pets: z.string().trim().min(1).max(500).nullable().optional(),
  photoUrls: z.array(z.url().max(2_048)).max(20).optional(),
  viewingHours: z.string().trim().min(1).max(500).nullable().optional(),
  immediateViewingAvailable: nullableBoolean,
  facilityCheckedAt: z.iso.date().nullable().optional(),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ listingId: string }> },
) {
  const responseContext = createRequestContext({ pragma: "no-cache" });
  const { listingId } = await context.params;
  if (!z.uuid().safeParse(listingId).success)
    return publicErrorResponse(
      responseContext,
      "INVALID_LISTING",
      "매물 식별자를 확인해 주세요.",
      400,
    );
  if (!isAllowedOrigin(request))
    return publicErrorResponse(
      responseContext,
      "INVALID_ORIGIN",
      "허용되지 않은 요청입니다.",
      403,
    );
  try {
    const admin = await requireAdminAal2("LEAD_WRITE");
    if (!admin.userId)
      return publicErrorResponse(
        responseContext,
        "DEVELOPMENT_BYPASS_UNSUPPORTED",
        "실제 관리자 계정으로 로그인해 주세요.",
        409,
      );
    const parsed = listingSchema.safeParse(await request.json());
    if (!parsed.success)
      return publicErrorResponse(
        responseContext,
        "INVALID_BODY",
        "매물 조건을 확인해 주세요.",
        400,
      );
    const values = parsed.data;
    const { data, error } = await createAdminClient()
      .from("homes")
      .update({
        transfer_registration_available: values.transferRegistrationAvailable,
        minimum_term_months: values.minimumTermMonths,
        monthly_price_1: values.monthlyPrice1,
        monthly_price_3: values.monthlyPrice3,
        monthly_price_4: values.monthlyPrice4,
        monthly_price_6: values.monthlyPrice6,
        deposit_amount: values.depositAmount,
        management_fee_amount: values.managementFeeAmount,
        kitchen_available: values.kitchenAvailable,
        curfew: values.curfew,
        air_conditioner_available: values.airConditionerAvailable,
        bathroom_type: values.bathroomType,
        other_family_members_live: values.otherFamilyMembersLive,
        host_gender: values.hostGender,
        host_introduction: values.hostIntroduction,
        pets: values.pets,
        photo_urls: values.photoUrls,
        viewing_hours: values.viewingHours,
        immediate_viewing_available: values.immediateViewingAvailable,
        facility_checked_at: values.facilityCheckedAt,
      })
      .eq("id", listingId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return publicErrorResponse(
        responseContext,
        "NOT_FOUND",
        "매물을 찾을 수 없습니다.",
        404,
      );
    const { error: auditError } = await createAdminClient()
      .from("audit_logs")
      .insert({
        admin_id: admin.userId,
        entity_type: "HOME",
        entity_id: listingId,
        action: "UPDATE_LISTING_FUNNEL_FIELDS",
        after_json: { verifiedFields: Object.keys(values).sort() },
      });
    if (auditError) throw auditError;
    return jsonResponse(responseContext, { ok: true });
  } catch (error) {
    const authorization = adminAuthorizationErrorResponse(
      responseContext,
      error,
    );
    if (authorization) return authorization;
    logSanitizedApiError("admin_listing_update_failed", responseContext, error);
    return publicErrorResponse(
      responseContext,
      "LISTING_UPDATE_FAILED",
      "매물 조건을 저장하지 못했습니다.",
      500,
    );
  }
}
