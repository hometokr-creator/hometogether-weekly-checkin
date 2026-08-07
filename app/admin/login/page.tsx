import type { Metadata } from "next";

import { isDevelopmentAdminBypassEnabled } from "@/lib/auth/admin";

import { AdminLoginForm } from "./login-form";

type AdminLoginPageProps = {
  searchParams: Promise<{
    next?: string | string[];
    error?: string | string[];
  }>;
};

export const metadata: Metadata = {
  title: "운영팀 로그인",
  robots: { index: false, follow: false },
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeNextPath(value: string | undefined): string {
  if (
    value &&
    (value === "/admin" || value.startsWith("/admin/")) &&
    !value.startsWith("//") &&
    value !== "/admin/login"
  ) {
    return value;
  }

  return "/admin/checkins";
}

export default async function AdminLoginPage({
  searchParams,
}: AdminLoginPageProps) {
  const params = await searchParams;

  return (
    <AdminLoginForm
      nextPath={safeNextPath(firstValue(params.next))}
      initialError={firstValue(params.error)}
      developmentBypassEnabled={isDevelopmentAdminBypassEnabled()}
    />
  );
}
