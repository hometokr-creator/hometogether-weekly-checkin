import "server-only";

import { redirect } from "next/navigation";

import {
  createClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";
import {
  AdminEmailConfigurationError,
  isConfiguredAdminEmail,
} from "@/lib/auth/admin-config";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { needsAdminAal2 } from "@/lib/auth/mfa-policy";

export const ADMIN_PERMISSIONS = [
  "CHECKIN_READ",
  "SAFETY_READ",
  "CONTACT_READ",
  "DATA_EXPORT",
  "CASE_WRITE",
  "LEAD_READ",
  "LEAD_WRITE",
  "LEAD_IMPORT",
  "LEAD_ANALYTICS",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminMembershipPermission = AdminPermission | "SUPER_ADMIN";
export type AdminRequiredPermission = AdminMembershipPermission;

export type AdminContext = {
  userId: string | null;
  email: string | null;
  permissions: AdminMembershipPermission[];
  isDevelopmentBypass: boolean;
  mfa?: AdminMfaState;
};

export type AdminMfaState = {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
  enrolled: boolean;
  enforcementEnabled: boolean;
};

type AdminFailure =
  "UNAUTHENTICATED" | "FORBIDDEN" | "MFA_REQUIRED" | "MISCONFIGURED";

type AdminResolutionOptions = {
  includeMfa?: boolean;
  requireAal2?: boolean;
};

type AdminResolution =
  | { context: AdminContext; failure: null }
  | { context: null; failure: AdminFailure };

export class AdminAuthorizationError extends Error {
  readonly code: AdminFailure;
  readonly status: 401 | 403 | 503;

  constructor(code: AdminFailure) {
    const details = {
      UNAUTHENTICATED: {
        message: "Authentication is required.",
        status: 401 as const,
      },
      FORBIDDEN: {
        message: "Administrator permission is required.",
        status: 403 as const,
      },
      MFA_REQUIRED: {
        message: "Administrator MFA verification is required.",
        status: 403 as const,
      },
      MISCONFIGURED: {
        message: "Administrator authentication is not configured.",
        status: 503 as const,
      },
    }[code];

    super(details.message);
    this.name = "AdminAuthorizationError";
    this.code = code;
    this.status = details.status;
  }
}

export function isDevelopmentAdminBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_ADMIN === "true"
  );
}

export function isAdminMfaEnforcementEnabled(): boolean {
  return process.env.ADMIN_MFA_ENFORCEMENT_ENABLED === "true";
}

export function hasAdminPermission(
  permissions: readonly AdminMembershipPermission[],
  permission: AdminRequiredPermission,
): boolean {
  return (
    permissions.includes("SUPER_ADMIN") || permissions.includes(permission)
  );
}

function isAdminMembershipPermission(
  value: string,
): value is AdminMembershipPermission {
  return (
    value === "SUPER_ADMIN" ||
    (ADMIN_PERMISSIONS as readonly string[]).includes(value)
  );
}

function normalizePermissions(value: unknown): AdminMembershipPermission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (permission): permission is AdminMembershipPermission =>
      typeof permission === "string" && isAdminMembershipPermission(permission),
  );
}

type MembershipRow = {
  user_id: string;
  permissions: unknown;
  is_active: boolean;
};

async function provisionConfiguredMembership(user: {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}): Promise<MembershipRow | null> {
  if (!user.email_confirmed_at || !isConfiguredAdminEmail(user.email)) {
    return null;
  }
  if (!isSupabaseAdminConfigured()) {
    throw new AdminEmailConfigurationError();
  }

  const { data, error } = await createAdminClient().rpc(
    "provision_configured_admin",
    {
      p_user_id: user.id,
      p_expected_email: user.email!.trim().toLowerCase(),
      p_grant_source: "ENV_ALLOWLIST",
    },
  );
  if (error) throw error;
  return data as MembershipRow | null;
}

async function resolveAdmin(
  requiredPermission: AdminRequiredPermission | null,
  options: AdminResolutionOptions = {},
): Promise<AdminResolution> {
  if (isDevelopmentAdminBypassEnabled()) {
    return {
      context: {
        userId: null,
        email: "development-admin@local.invalid",
        permissions: ["SUPER_ADMIN", ...ADMIN_PERMISSIONS],
        isDevelopmentBypass: true,
        mfa:
          options.includeMfa || options.requireAal2
            ? {
                currentLevel: "aal2",
                nextLevel: "aal2",
                enrolled: true,
                enforcementEnabled: false,
              }
            : undefined,
      },
      failure: null,
    };
  }

  if (!isSupabaseServerConfigured()) {
    return { context: null, failure: "MISCONFIGURED" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { context: null, failure: "UNAUTHENTICATED" };
  }

  const membershipResult = await supabase
    .from("admin_memberships")
    .select("user_id, permissions, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  let membership = membershipResult.data;
  const membershipError = membershipResult.error;

  if (membershipError) {
    return { context: null, failure: "FORBIDDEN" };
  }

  if (!membership) {
    try {
      membership = await provisionConfiguredMembership(user);
    } catch (error) {
      return {
        context: null,
        failure:
          error instanceof AdminEmailConfigurationError
            ? "MISCONFIGURED"
            : "FORBIDDEN",
      };
    }
  }

  const permissions = normalizePermissions(membership?.permissions);

  if (
    !membership ||
    membership.is_active !== true ||
    permissions.length === 0 ||
    (requiredPermission !== null &&
      !permissions.includes("SUPER_ADMIN") &&
      !permissions.includes(requiredPermission))
  ) {
    return { context: null, failure: "FORBIDDEN" };
  }

  // This SECURITY DEFINER function is the authoritative DB permission check.
  // The local check above prevents an unnecessary RPC for inactive accounts;
  // neither client metadata nor ADMIN_EMAILS alone grants request access.
  const databasePermission = requiredPermission ?? permissions[0];
  if (!databasePermission) {
    return { context: null, failure: "FORBIDDEN" };
  }
  const { data: isAllowed, error: permissionError } = await supabase.rpc(
    "is_admin",
    { required_permission: databasePermission },
  );

  if (permissionError || isAllowed !== true) {
    return { context: null, failure: "FORBIDDEN" };
  }

  let mfa: AdminMfaState | undefined;
  if (options.includeMfa || options.requireAal2) {
    const enrolled = Boolean(
      user.factors?.some(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ),
    );
    const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const currentLevel = assurance.error
      ? null
      : (assurance.data.currentLevel as "aal1" | "aal2" | null);
    const nextLevel = assurance.error
      ? enrolled
        ? "aal2"
        : "aal1"
      : (assurance.data.nextLevel as "aal1" | "aal2" | null);
    mfa = {
      currentLevel,
      nextLevel,
      enrolled: enrolled || nextLevel === "aal2",
      enforcementEnabled: isAdminMfaEnforcementEnabled(),
    };

    // Existing administrators remain able to enroll while the rollout flag is
    // disabled. Once a verified factor exists, sensitive operations always
    // require a fresh AAL2 session even before global enforcement is enabled.
    if (options.requireAal2 && needsAdminAal2(mfa)) {
      return { context: null, failure: "MFA_REQUIRED" };
    }
  }

  return {
    context: {
      userId: user.id,
      email: user.email ?? null,
      permissions,
      isDevelopmentBypass: false,
      mfa,
    },
    failure: null,
  };
}

export async function getAdminContext(
  requiredPermission: AdminRequiredPermission = "CHECKIN_READ",
): Promise<AdminContext | null> {
  const result = await resolveAdmin(requiredPermission);
  return result.context;
}

/**
 * API/data-layer guard. Route Handlers can map the thrown status to 401/403.
 */
export async function requireAdmin(
  requiredPermission: AdminRequiredPermission = "CHECKIN_READ",
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission);

  if (!result.context) {
    throw new AdminAuthorizationError(result.failure);
  }

  return result.context;
}

export async function requireAdminWithMfa(
  requiredPermission: AdminRequiredPermission = "CHECKIN_READ",
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission, { includeMfa: true });
  if (!result.context) throw new AdminAuthorizationError(result.failure);
  return result.context;
}

/**
 * Session/enrollment guard for any active administrator. This avoids locking a
 * least-privilege administrator out of MFA setup merely because they do not
 * have CHECKIN_READ.
 */
export async function requireAnyAdminWithMfa(): Promise<AdminContext> {
  const result = await resolveAdmin(null, { includeMfa: true });
  if (!result.context) throw new AdminAuthorizationError(result.failure);
  return result.context;
}

export async function requireAdminAal2(
  requiredPermission: AdminRequiredPermission,
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission, {
    includeMfa: true,
    requireAal2: true,
  });
  if (!result.context) throw new AdminAuthorizationError(result.failure);
  return result.context;
}

function safeAdminPath(path: string): string {
  if (
    (path === "/admin" || path.startsWith("/admin/")) &&
    !path.startsWith("//") &&
    path !== "/admin/login"
  ) {
    return path;
  }

  return "/admin/checkins";
}

/** Page guard that preserves a safe, same-origin admin return path. */
export async function requireAdminPage(
  requiredPermission: AdminRequiredPermission = "CHECKIN_READ",
  nextPath = "/admin/checkins",
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission);

  if (result.context) {
    return result.context;
  }

  const searchParams = new URLSearchParams({ next: safeAdminPath(nextPath) });

  if (result.failure === "FORBIDDEN") {
    searchParams.set("error", "forbidden");
  } else if (result.failure === "MISCONFIGURED") {
    searchParams.set("error", "configuration");
  }

  redirect(`/admin/login?${searchParams.toString()}`);
}

export async function requireAnyAdminPage(
  nextPath = "/admin/mfa",
): Promise<AdminContext> {
  const result = await resolveAdmin(null);
  if (result.context) return result.context;

  const searchParams = new URLSearchParams({ next: safeAdminPath(nextPath) });
  if (result.failure === "FORBIDDEN") searchParams.set("error", "forbidden");
  if (result.failure === "MISCONFIGURED") {
    searchParams.set("error", "configuration");
  }
  redirect(`/admin/login?${searchParams.toString()}`);
}

export async function requireAdminAal2Page(
  requiredPermission: AdminRequiredPermission,
  nextPath: string,
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission, {
    includeMfa: true,
    requireAal2: true,
  });

  if (result.context) return result.context;
  if (result.failure === "MFA_REQUIRED") {
    const searchParams = new URLSearchParams({ next: safeAdminPath(nextPath) });
    redirect(`/admin/mfa?${searchParams.toString()}`);
  }

  const searchParams = new URLSearchParams({ next: safeAdminPath(nextPath) });
  if (result.failure === "FORBIDDEN") searchParams.set("error", "forbidden");
  if (result.failure === "MISCONFIGURED")
    searchParams.set("error", "configuration");
  redirect(`/admin/login?${searchParams.toString()}`);
}
