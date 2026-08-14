import { createClient, type User } from "@supabase/supabase-js";

const permissions = [
  "CHECKIN_READ",
  "SAFETY_READ",
  "CONTACT_READ",
  "DATA_EXPORT",
  "CASE_WRITE",
  "LEAD_READ",
  "LEAD_WRITE",
  "LEAD_IMPORT",
  "LEAD_ANALYTICS",
  "SUPER_ADMIN",
] as const;

type Permission = (typeof permissions)[number];
type Command = "list" | "add" | "update" | "deactivate" | "reactivate";

type ParsedArguments = {
  command: Command;
  targetEmail?: string;
  actorEmail: string;
  permissions?: Permission[];
  reason?: string;
};

const defaultAdminPermissions: Permission[] = [
  "CHECKIN_READ",
  "SAFETY_READ",
  "CASE_WRITE",
];

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  pnpm admin:manage -- list --actor actor@example.com",
      "  pnpm admin:manage -- add target@example.com --actor actor@example.com [--permissions CHECKIN_READ,LEAD_READ]",
      "  pnpm admin:manage -- update target@example.com --actor actor@example.com --permissions CHECKIN_READ,LEAD_READ,LEAD_WRITE",
      '  pnpm admin:manage -- deactivate target@example.com --actor actor@example.com --reason "role ended"',
      "  pnpm admin:manage -- reactivate target@example.com --actor actor@example.com [--permissions CHECKIN_READ,LEAD_READ]",
    ].join("\n"),
  );
}

function normalizeEmail(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : undefined;
}

function parsePermissions(value: string | undefined): Permission[] | undefined {
  if (!value) return undefined;
  const parsed = [
    ...new Set(value.split(",").map((item) => item.trim().toUpperCase())),
  ];
  if (
    parsed.length === 0 ||
    parsed.some(
      (permission) => !(permissions as readonly string[]).includes(permission),
    )
  ) {
    throw new Error("--permissions contains an unsupported value");
  }
  return parsed as Permission[];
}

export function parseAdminManageArguments(argv: string[]): ParsedArguments {
  const command = argv[0] as Command | undefined;
  if (
    !command ||
    !["list", "add", "update", "deactivate", "reactivate"].includes(command)
  ) {
    return usage();
  }

  const targetEmail = command === "list" ? undefined : normalizeEmail(argv[1]);
  if (command !== "list" && !targetEmail) return usage();
  const flagStart = command === "list" ? 1 : 2;
  const flags = new Map<string, string>();
  for (let index = flagStart; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--"))
      return usage();
    if (flags.has(name)) throw new Error(`Duplicate option: ${name}`);
    flags.set(name, value);
  }

  const supported = new Set(["--actor", "--permissions", "--reason"]);
  for (const name of flags.keys()) {
    if (!supported.has(name)) throw new Error(`Unsupported option: ${name}`);
  }

  const actorEmail = normalizeEmail(flags.get("--actor"));
  if (!actorEmail) return usage();
  const selectedPermissions = parsePermissions(flags.get("--permissions"));
  const reason = flags.get("--reason")?.trim();
  if (reason && reason.length > 500)
    throw new Error("--reason must be 500 characters or fewer");
  if (command === "update" && !selectedPermissions) {
    throw new Error("update requires --permissions");
  }
  if (command === "deactivate" && !reason) {
    throw new Error("deactivate requires --reason");
  }

  return {
    command,
    targetEmail,
    actorEmail,
    permissions: selectedPermissions,
    reason,
  };
}

function maskEmail(email: string | null | undefined): string {
  if (!email) return "(email unavailable)";
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

function createServiceClient(url: string, secret: string) {
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listAllAuthUsers(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error("Auth user search limit reached");
}

function findVerifiedUser(users: User[], email: string): User {
  const user = users.find(
    (candidate) => candidate.email?.trim().toLowerCase() === email,
  );
  if (!user) throw new Error("Existing Supabase Auth user was not found");
  if (!user.email_confirmed_at)
    throw new Error("Auth user email is not verified");
  return user;
}

async function main() {
  const args = parseAdminManageArguments(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret)
    throw new Error("Supabase server configuration is missing");

  const supabase = createServiceClient(url, secret);
  const authUsers = await listAllAuthUsers(supabase);
  const actor = findVerifiedUser(authUsers, args.actorEmail);
  const { data: actorAllowed, error: actorError } = await supabase.rpc(
    "admin_has_permission",
    { p_user_id: actor.id, p_required_permission: "SUPER_ADMIN" },
  );
  if (actorError) throw actorError;
  if (actorAllowed !== true)
    throw new Error("Actor is not an active SUPER_ADMIN");

  const { data: memberships, error: membershipError } = await supabase
    .from("admin_memberships")
    .select("user_id,permissions,is_active,grant_source,created_at")
    .order("created_at", { ascending: true });
  if (membershipError) throw membershipError;
  const membershipByUserId = new Map(
    (memberships ?? []).map((membership) => [
      String(membership.user_id),
      membership,
    ]),
  );

  if (args.command === "list") {
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    const output = (memberships ?? []).map((membership) => ({
      email: maskEmail(authById.get(String(membership.user_id))?.email),
      permissions: membership.permissions,
      active: membership.is_active === true,
      grantSource: membership.grant_source,
    }));
    console.info(JSON.stringify(output, null, 2));
    return;
  }

  const target = findVerifiedUser(authUsers, args.targetEmail!);
  const existing = membershipByUserId.get(target.id) as
    { permissions?: unknown; is_active?: boolean } | undefined;
  if (args.command === "add" && existing) {
    throw new Error("Target already has an administrator membership");
  }
  if (args.command !== "add" && !existing) {
    throw new Error("Target does not have an administrator membership");
  }

  const existingPermissions = Array.isArray(existing?.permissions)
    ? existing.permissions.filter(
        (value): value is Permission =>
          typeof value === "string" &&
          (permissions as readonly string[]).includes(value),
      )
    : [];
  const nextPermissions =
    args.permissions ??
    (args.command === "add" ? defaultAdminPermissions : existingPermissions);
  if (!nextPermissions.length)
    throw new Error("At least one permission is required");
  const nextActive = args.command !== "deactivate";

  const { error } = await supabase.rpc("admin_set_membership", {
    p_actor_id: actor.id,
    p_target_user_id: target.id,
    p_permissions: nextPermissions,
    p_is_active: nextActive,
    p_reason: args.reason ?? null,
  });
  if (error) {
    if (
      error.code === "23514" ||
      error.message.includes("last_super_admin_protected")
    ) {
      throw new Error(
        "The last active SUPER_ADMIN cannot be deactivated or demoted",
      );
    }
    throw error;
  }

  console.info(
    `${args.command} completed for ${maskEmail(target.email)} by ${maskEmail(actor.email)}`,
  );
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Administrator command failed",
    );
    process.exitCode = 1;
  });
}
