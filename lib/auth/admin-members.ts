import "server-only";

import type { AdminMembershipPermission } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

type JsonRow = Record<string, unknown>;

export type AdminMember = {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  permissions: AdminMembershipPermission[];
  isActive: boolean;
  grantSource: string;
  createdAt: string;
  updatedAt: string;
  deactivatedAt?: string;
};

export type AdminMembershipUpdate = {
  permissions: AdminMembershipPermission[];
  isActive: boolean;
  reason?: string;
};

function normalizePermissions(value: unknown): AdminMembershipPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (permission): permission is AdminMembershipPermission =>
      permission === "CHECKIN_READ" ||
      permission === "SAFETY_READ" ||
      permission === "CONTACT_READ" ||
      permission === "DATA_EXPORT" ||
      permission === "CASE_WRITE" ||
      permission === "SUPER_ADMIN",
  );
}

async function listAllAuthUsers() {
  const supabase = createAdminClient();
  const users: Array<{
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
  }> = [];

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    if (page === 100) throw new Error("ADMIN_USER_SEARCH_LIMIT_REACHED");
  }

  return users;
}

export async function findVerifiedAuthUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const user = (await listAllAuthUsers()).find(
    (candidate) => candidate.email?.trim().toLowerCase() === normalized,
  );
  if (!user) return { status: "NOT_FOUND" as const, user: null };
  if (!user.email_confirmed_at) {
    return { status: "UNVERIFIED" as const, user };
  }
  return { status: "VERIFIED" as const, user };
}

export async function listAdminMembers(): Promise<AdminMember[]> {
  const supabase = createAdminClient();
  const [membershipResult, authUsers] = await Promise.all([
    supabase
      .from("admin_memberships")
      .select(
        "user_id,permissions,is_active,grant_source,created_at,updated_at,deactivated_at",
      )
      .order("created_at", { ascending: true }),
    listAllAuthUsers(),
  ]);
  if (membershipResult.error) throw membershipResult.error;

  const authById = new Map(authUsers.map((user) => [user.id, user]));
  return ((membershipResult.data ?? []) as JsonRow[]).map((row) => {
    const userId = String(row.user_id ?? "");
    const authUser = authById.get(userId);
    return {
      userId,
      email: authUser?.email?.trim().toLowerCase() ?? null,
      emailVerified: Boolean(authUser?.email_confirmed_at),
      permissions: normalizePermissions(row.permissions),
      isActive: row.is_active === true,
      grantSource: String(row.grant_source ?? "LEGACY"),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deactivatedAt:
        typeof row.deactivated_at === "string" ? row.deactivated_at : undefined,
    };
  });
}

export async function setAdminMembership(
  actorId: string,
  targetUserId: string,
  update: AdminMembershipUpdate,
): Promise<void> {
  const { error } = await createAdminClient().rpc("admin_set_membership", {
    p_actor_id: actorId,
    p_target_user_id: targetUserId,
    p_permissions: update.permissions,
    p_is_active: update.isActive,
    p_reason: update.reason?.trim() || null,
  });
  if (error) throw error;
}
