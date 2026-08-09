import Link from "next/link";
import { Upload } from "lucide-react";

import { CsvExportPanel } from "@/components/admin/CsvExportPanel";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminPage } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminDataPage() {
  await requireAdminPage("SUPER_ADMIN", "/admin/data");
  return (
    <AdminShell
      active="data"
      eyebrow="AUDITED DATA EXPORT"
      title="운영 데이터 CSV"
      description="모든 다운로드는 관리자 권한을 서버에서 다시 확인하고 감사 로그에 종류·건수·적용 필터를 기록합니다. Excel 수식 주입을 차단하며 UTF-8 BOM을 포함합니다."
      actions={
        <Link
          href="/admin/import"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#176b52] px-4 text-sm font-extrabold text-white no-underline outline-none hover:bg-[#0d523e] focus-visible:ring-4 focus-visible:ring-[#176b52]/20"
        >
          <Upload size={17} aria-hidden="true" /> 운영 CSV 가져오기
        </Link>
      }
    >
      <aside className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Profiles와 응답 CSV에는 개인정보가 포함될 수 있습니다. 업무상 필요한 최소 기간만 내려받고 승인된 저장 위치에서만 보관하세요.
      </aside>
      <CsvExportPanel />
    </AdminShell>
  );
}
