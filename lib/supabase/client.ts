"use client";

import { createBrowserClient } from "@supabase/ssr";

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let browserClient: BrowserSupabaseClient | undefined;

function getBrowserConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function isSupabaseBrowserConfigured(): boolean {
  const { url, publishableKey } = getBrowserConfiguration();
  return Boolean(url && publishableKey);
}

/**
 * Creates the cookie-aware Supabase client used by Client Components.
 *
 * Only publishable (or legacy anon) keys are accepted here. Elevated keys
 * belong exclusively in lib/supabase/admin.ts.
 */
export function createClient(): BrowserSupabaseClient {
  const { url, publishableKey } = getBrowserConfiguration();

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase browser configuration is missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  browserClient ??= createBrowserClient(url, publishableKey);
  return browserClient;
}

