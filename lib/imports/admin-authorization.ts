import "server-only";

import {
  AdminAuthorizationError,
  requireAdminAal2,
  type AdminContext,
} from "@/lib/auth/admin";

export async function requireImportSuperAdmin(): Promise<AdminContext> {
  const admin = await requireAdminAal2("SUPER_ADMIN");
  if (!admin.permissions.includes("SUPER_ADMIN")) {
    throw new AdminAuthorizationError("FORBIDDEN");
  }
  return admin;
}
