import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

function getSupabaseConfiguration() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey:
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

function isDevelopmentBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_DEV_ADMIN === "true"
  );
}

function copyAuthCookies(
  source: NextResponse,
  destination: NextResponse,
): NextResponse {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));

  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(header);
    if (value) destination.headers.set(header, value);
  }

  return destination;
}

function withAdminPrivacyHeaders(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  response.headers.set("referrer-policy", "same-origin");
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}

export async function proxy(request: NextRequest) {
  const isDevelopmentRoute =
    request.nextUrl.pathname === "/dev" ||
    request.nextUrl.pathname.startsWith("/dev/") ||
    request.nextUrl.pathname.startsWith("/api/dev/");

  // Development fixtures must never be reachable from a production
  // deployment, even if a route-level guard is accidentally removed later.
  if (isDevelopmentRoute) {
    return process.env.NODE_ENV === "production"
      ? new NextResponse(null, {
          status: 404,
          headers: {
            "cache-control": "private, no-store, max-age=0",
            "x-robots-tag": "noindex, nofollow",
          },
        })
      : NextResponse.next({ request });
  }

  const isAuthenticationEntry =
    request.nextUrl.pathname === "/admin/login" ||
    request.nextUrl.pathname === "/admin/bootstrap";

  if (isDevelopmentBypassEnabled()) {
    return withAdminPrivacyHeaders(NextResponse.next({ request }));
  }

  const { url, publishableKey } = getSupabaseConfiguration();

  if (!url || !publishableKey) {
    if (isAuthenticationEntry) {
      return withAdminPrivacyHeaders(NextResponse.next({ request }));
    }

    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    loginUrl.searchParams.set("error", "configuration");
    return withAdminPrivacyHeaders(NextResponse.redirect(loginUrl));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headersToSet).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // Optimistic session check and refresh only. DB-backed admin authorization
  // is repeated by requireAdmin/requireAdminPage at the data boundary.
  const { data, error } = await supabase.auth.getClaims();

  if ((!data?.claims || error) && !isAuthenticationEntry) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return withAdminPrivacyHeaders(
      copyAuthCookies(response, NextResponse.redirect(loginUrl)),
    );
  }

  return withAdminPrivacyHeaders(response);
}

export const config = {
  matcher: ["/admin/:path*", "/dev/:path*", "/api/dev/:path*"],
};
