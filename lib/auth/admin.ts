import "server-only";

import { redirect } from "next/navigation";

import {
  createClient,
  isSupabaseServerConfigured,
} from "@/lib/supabase/server";

export const ADMIN_PERMISSIONS = [
  "CHECKIN_READ",
  "SAFETY_READ",
  "CASE_WRITE",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminMembershipPermission = AdminPermission | "SUPER_ADMIN";

export type AdminContext = {
  userId: string | null;
  email: string | null;
  permissions: AdminMembershipPermission[];
  isDevelopmentBypass: boolean;
};

type AdminFailure = "UNAUTHENTICATED" | "FORBIDDEN" | "MISCONFIGURED";

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
      typeof permission === "string" &&
      isAdminMembershipPermission(permission),
  );
}

async function resolveAdmin(
  requiredPermission: AdminPermission,
): Promise<AdminResolution> {
  if (isDevelopmentAdminBypassEnabled()) {
    return {
      context: {
        userId: null,
        email: "development-admin@local.invalid",
        permissions: ["SUPER_ADMIN", ...ADMIN_PERMISSIONS],
        isDevelopmentBypass: true,
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

  // This SECURITY DEFINER function reads the authoritative DB membership and
  // is executable only by authenticated users. Never infer admin access from
  // client-controlled user_metadata.
  const { data: isAllowed, error: permissionError } = await supabase.rpc(
    "is_admin",
    { required_permission: requiredPermission },
  );

  if (permissionError || isAllowed !== true) {
    return { context: null, failure: "FORBIDDEN" };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("admin_memberships")
    .select("user_id, permissions, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  const permissions = normalizePermissions(membership?.permissions);

  if (
    membershipError ||
    !membership ||
    membership.is_active !== true ||
    (!permissions.includes("SUPER_ADMIN") &&
      !permissions.includes(requiredPermission))
  ) {
    return { context: null, failure: "FORBIDDEN" };
  }

  return {
    context: {
      userId: user.id,
      email: user.email ?? null,
      permissions,
      isDevelopmentBypass: false,
    },
    failure: null,
  };
}

export async function getAdminContext(
  requiredPermission: AdminPermission = "CHECKIN_READ",
): Promise<AdminContext | null> {
  const result = await resolveAdmin(requiredPermission);
  return result.context;
}

/**
 * API/data-layer guard. Route Handlers can map the thrown status to 401/403.
 */
export async function requireAdmin(
  requiredPermission: AdminPermission = "CHECKIN_READ",
): Promise<AdminContext> {
  const result = await resolveAdmin(requiredPermission);

  if (!result.context) {
    throw new AdminAuthorizationError(result.failure);
  }

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
  requiredPermission: AdminPermission = "CHECKIN_READ",
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
