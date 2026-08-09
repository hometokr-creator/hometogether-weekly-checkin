import "server-only";

import {
  AdminAuthorizationError,
  requireAdmin,
  type AdminContext,
} from "@/lib/auth/admin";

export async function requireImportSuperAdmin(): Promise<AdminContext> {
  const admin = await requireAdmin("CHECKIN_READ");
  if (!admin.permissions.includes("SUPER_ADMIN")) {
    throw new AdminAuthorizationError("FORBIDDEN");
  }
  return admin;
}
