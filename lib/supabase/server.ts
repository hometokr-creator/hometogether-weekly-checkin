import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getServerConfiguration() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabaseServerConfigured(): boolean {
  const { url, publishableKey } = getServerConfiguration();
  return Boolean(url && publishableKey);
}

/**
 * Creates a request-scoped Supabase client carrying the signed-in user's JWT.
 * Queries made through this client are subject to that user's RLS policies.
 */
export async function createClient() {
  const { url, publishableKey } = getServerConfiguration();

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase server configuration is missing. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. proxy.ts refreshes the
          // session before rendering and persists refreshed cookies instead.
        }
      },
    },
  });
}

