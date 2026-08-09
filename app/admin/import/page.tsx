import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/AdminShell";
import { CriticalNotice, SectionCard } from "@/components/admin/AdminPrimitives";
import { requireAdminPage } from "@/lib/auth/admin";

import { OperationalImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OperationalImportPage() {
  const admin = await requireAdminPage("CHECKIN_READ", "/admin/import");
  const isSuperAdmin = admin.permissions.includes("SUPER_ADMIN");

  return (
    <AdminShell
      active="checkins"
      eyebrow="운영 데이터"
      title="집주인·학생·주거지·계약 가져오기"
      description="CSV를 먼저 검증하고 예상 변경을 확인한 뒤 하나의 트랜잭션으로 적용합니다. 미리보기 단계에서는 운영 DB를 변경하지 않습니다."
    >
      {!isSuperAdmin ? (
        <CriticalNotice>
          <p className="m-0 font-bold">SUPER_ADMIN 권한이 필요한 화면입니다.</p>
          <p className="mb-0 mt-2">운영 데이터 가져오기는 기존 최고 관리자가 권한을 부여한 계정에서만 실행할 수 있습니다.</p>
        </CriticalNotice>
      ) : (
        <div className="grid gap-6">
          <SectionCard
            title="가져오기 안전 원칙"
            description="이름으로 기존 이용자를 자동 병합하지 않으며, 같은 원본 ID만 갱신합니다. 알림 동의는 CSV에 명시해야 하고 기본값은 비활성입니다."
          >
            <ul className="m-0 grid gap-2 pl-5 text-sm leading-6 text-[#52635c]">
              <li>한 행은 집주인·학생·주거지와 하나의 계약을 나타냅니다.</li>
              <li>한국 휴대전화번호만 E.164 형식으로 정규화합니다.</li>
              <li>오류나 중복 의심이 한 건이라도 있으면 적용할 수 없습니다.</li>
              <li>적용 직전 DB 상태로 계획을 다시 계산해 오래된 미리보기를 차단합니다.</li>
            </ul>
          </SectionCard>
          <OperationalImportWizard />
        </div>
      )}
    </AdminShell>
  );
}
