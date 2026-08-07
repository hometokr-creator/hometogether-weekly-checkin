import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | undefined;

function getAdminConfiguration() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey:
      process.env.SUPABASE_SECRET_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function isSupabaseAdminConfigured(): boolean {
  const { url, secretKey } = getAdminConfiguration();
  return Boolean(url && secretKey);
}

/**
 * Returns the elevated client used by cron jobs and token-validated server
 * routes. This client bypasses RLS; callers must authenticate and authorize
 * the request before using it.
 */
export function createAdminClient(): SupabaseClient {
  const { url, secretKey } = getAdminConfiguration();

  if (!url || !secretKey) {
    throw new Error(
      "Supabase admin configuration is missing. Set SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  adminClient ??= createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return adminClient;
}

export const getAdminClient = createAdminClient;

