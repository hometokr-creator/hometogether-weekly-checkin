import { createClient } from "@supabase/supabase-js";

import { getConfiguredAdminEmails } from "../lib/auth/admin-config";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run admin:grant -- user@example.com");
  if (!getConfiguredAdminEmails().includes(email)) {
    throw new Error("Target email is not included in ADMIN_EMAILS");
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase server configuration is missing");

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let target:
    | { id: string; email?: string | null; email_confirmed_at?: string | null }
    | undefined;
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    target = data.users.find((user) => user.email?.toLowerCase() === email);
    if (target || data.users.length < 1000) break;
  }
  if (!target) throw new Error("Existing Supabase Auth user was not found");
  if (!target.email_confirmed_at) throw new Error("Auth user email is not verified");

  const { data, error } = await supabase.rpc("provision_configured_admin", {
    p_user_id: target.id,
    p_expected_email: email,
    p_grant_source: "CLI",
  });
  if (error) throw error;
  const membership = data as { is_active?: boolean } | null;
  if (membership?.is_active !== true) {
    throw new Error("Membership is inactive; reactivate it from the administrator UI");
  }
  console.info(`Administrator access confirmed for ${maskEmail(email)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Administrator grant failed");
  process.exitCode = 1;
});
