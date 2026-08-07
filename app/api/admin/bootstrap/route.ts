import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  createRequestContext,
  jsonResponse,
  logSanitizedApiError,
  publicErrorResponse,
} from "@/app/api/_shared/responses";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bootstrapSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  bootstrapSecret: z.string().min(16).max(512),
});

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

async function findAuthUserByEmail(
  supabase: ReturnType<typeof createAdminClient>,
  email: string,
) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    if (user) return user;
    if (data.users.length < 1000) return null;
  }

  throw new Error("ADMIN_USER_SEARCH_LIMIT_REACHED");
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

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8192) {
    return publicErrorResponse(
      context,
      "PAYLOAD_TOO_LARGE",
      "요청 크기가 너무 큽니다.",
      413,
    );
  }

  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const configuredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!configuredEmail || !configuredSecret || configuredSecret.length < 16) {
    return publicErrorResponse(
      context,
      "BOOTSTRAP_NOT_CONFIGURED",
      "최초 관리자 등록이 설정되지 않았습니다.",
      503,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return publicErrorResponse(
      context,
      "INVALID_BODY",
      "입력값을 확인해 주세요.",
      400,
    );
  }

  const parsed = bootstrapSchema.safeParse(raw);
  if (!parsed.success) {
    return publicErrorResponse(
      context,
      "INVALID_BODY",
      "이메일, 12자 이상의 비밀번호와 등록 암호를 확인해 주세요.",
      400,
    );
  }

  const email = parsed.data.email.toLowerCase();
  if (
    email !== configuredEmail ||
    !constantTimeEqual(parsed.data.bootstrapSecret, configuredSecret)
  ) {
    return publicErrorResponse(
      context,
      "BOOTSTRAP_DENIED",
      "최초 관리자 등록 정보를 확인해 주세요.",
      403,
    );
  }

  try {
    const supabase = createAdminClient();
    const { count, error: membershipCountError } = await supabase
      .from("admin_memberships")
      .select("user_id", { count: "exact", head: true });
    if (membershipCountError) throw membershipCountError;

    // Any previous administrator membership disables the public bootstrap
    // path. The RPC below also records a permanent, singleton bootstrap marker
    // transactionally so deactivating an admin cannot reopen this endpoint.
    if ((count ?? 0) > 0) {
      return publicErrorResponse(
        context,
        "BOOTSTRAP_DISABLED",
        "최초 관리자 등록은 이미 완료되어 비활성화됐습니다.",
        409,
      );
    }

    let user = await findAuthUserByEmail(supabase, configuredEmail);
    if (user) {
      const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
        password: parsed.data.password,
        email_confirm: true,
      });
      if (error) throw error;
      user = data.user;
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: configuredEmail,
        password: parsed.data.password,
        email_confirm: true,
      });
      if (error) throw error;
      user = data.user;
    }

    if (!user) throw new Error("ADMIN_AUTH_USER_NOT_CREATED");

    const { error: membershipError } = await supabase.rpc(
      "bootstrap_first_admin",
      {
        p_user_id: user.id,
        p_expected_email: configuredEmail,
      },
    );
    if (membershipError) throw membershipError;

    return jsonResponse(
      context,
      {
        ok: true,
        bootstrapDisabled: true,
        message: "최초 관리자 등록을 완료했습니다. 로그인해 주세요.",
      },
      201,
    );
  } catch (error) {
    logSanitizedApiError("admin_bootstrap_failed", context, error);
    return publicErrorResponse(
      context,
      "BOOTSTRAP_FAILED",
      "관리자 등록을 완료하지 못했습니다. 문의 코드를 운영 담당자에게 알려 주세요.",
      500,
    );
  }
}
