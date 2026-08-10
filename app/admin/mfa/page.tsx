import type { Metadata } from "next";

import { AdminMfaSetup } from "@/components/admin/AdminMfaSetup";
import { AdminShell } from "@/components/admin/AdminShell";
import { SectionCard } from "@/components/admin/AdminPrimitives";
import {
  isAdminMfaEnforcementEnabled,
  requireAnyAdminPage,
} from "@/lib/auth/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

function safeNextPath(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && candidate.startsWith("/admin/") && !candidate.startsWith("//")
    ? candidate
    : "/admin/checkins";
}

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  await requireAnyAdminPage("/admin/mfa");
  const nextPath = safeNextPath((await searchParams).next);
  return (
    <AdminShell
      active="admins"
      eyebrow="ACCOUNT SECURITY"
      title="관리자 MFA"
      description="Supabase Auth TOTP로 인증 앱을 등록하고 민감 작업 전에 AAL2 세션을 확인합니다."
    >
      <SectionCard
        title="인증 앱 등록·추가 인증"
        description="기존 관리자는 등록을 완료하기 전까지 잠기지 않습니다. 등록 후에는 최고 관리자 및 민감 변경 작업에 추가 인증이 필요합니다."
      >
        <AdminMfaSetup
          nextPath={nextPath}
          enforcementEnabled={isAdminMfaEnforcementEnabled()}
        />
      </SectionCard>
    </AdminShell>
  );
}
