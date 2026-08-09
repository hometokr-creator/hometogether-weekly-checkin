import { AdminManagement } from "@/components/admin/AdminManagement";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminPage } from "@/lib/auth/admin";
import { getAdminEmailConfigurationSummary } from "@/lib/auth/admin-config";
import { listAdminMembers } from "@/lib/auth/admin-members";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  const admin = await requireAdminPage("SUPER_ADMIN", "/admin/admins");
  if (!admin.userId) {
    return null;
  }
  const [members, configuration] = await Promise.all([
    listAdminMembers(),
    Promise.resolve(getAdminEmailConfigurationSummary()),
  ]);

  return (
    <AdminShell
      active="admins"
      eyebrow="ACCESS CONTROL"
      title="관리자 계정"
      description="인증을 완료한 기존 계정에만 권한을 부여하고, 퇴사·업무 변경 시 즉시 비활성화합니다. 마지막 최고 관리자는 시스템에서 보호됩니다."
    >
      <aside className={`mb-6 rounded-2xl border p-4 text-sm leading-6 ${configuration.valid && configuration.configured ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <b className="block">ADMIN_EMAILS 상태</b>
        {configuration.valid
          ? `${configuration.count}개 이메일이 허용 목록에 등록되어 있습니다. 실제 주소는 화면에 노출하지 않습니다.`
          : "환경변수 형식이 올바르지 않습니다. 기존 DB 관리자는 계속 사용할 수 있지만 새 allowlist 권한 부여는 차단됩니다."}
      </aside>
      <AdminManagement initialMembers={members} currentUserId={admin.userId} />
    </AdminShell>
  );
}
