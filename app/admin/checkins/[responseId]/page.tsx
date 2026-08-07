import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { CaseActions } from "@/components/admin/CaseActions";
import {
  CaseStatusBadge,
  SectionCard,
} from "@/components/admin/AdminPrimitives";
import { ResponseDetailSections } from "@/components/admin/ResponseDetailSections";
import { formatKoreanDateTime, roleLabels } from "@/components/admin/admin-labels";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import type { DashboardResponseRow } from "@/lib/checkin/types";

export const dynamic = "force-dynamic";

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes("SUPER_ADMIN") || permissions.includes(permission);
}

function isSafetySensitive(response: DashboardResponseRow): boolean {
  return (
    response.riskLevel === "RED" ||
    Boolean(response.supportCase) ||
    Boolean(response.submission.safety) ||
    response.submission.issues.some((issue) => issue.category === "SAFETY")
  );
}

export default async function AdminCheckinResponsePage({
  params,
}: {
  params: Promise<{ responseId: string }>;
}) {
  const { responseId } = await params;
  const returnPath = `/admin/checkins/${encodeURIComponent(responseId)}`;
  let admin = await requireAdminPage("CHECKIN_READ", returnPath);
  const repository = await getCheckinRepository();
  const response = await repository.getResponse(responseId);

  if (!response) notFound();

  if (isSafetySensitive(response) && !hasPermission(admin.permissions, "SAFETY_READ")) {
    admin = await requireAdminPage("SAFETY_READ", returnPath);
  }

  const dashboard = await repository.getDashboard();
  const canReadSafety = hasPermission(admin.permissions, "SAFETY_READ");
  const authorizedRelatedResponses = canReadSafety
    ? dashboard.responses
    : dashboard.responses.filter((item) => !isSafetySensitive(item));
  const previousResponses = authorizedRelatedResponses
    .filter(
      (item) => item.participantId === response.participantId && item.id !== response.id,
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const counterpart = authorizedRelatedResponses
    .filter(
      (item) =>
        item.matchId === response.matchId &&
        item.participantId !== response.participantId &&
        item.period === response.period,
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  const supportCase =
    response.supportCase ??
    dashboard.supportCases.find((item) => item.responseId === response.id);
  const canWriteCases = hasPermission(admin.permissions, "CASE_WRITE");
  const isTest = (response as DashboardResponseRow & { isTest?: boolean }).isTest === true;

  return (
    <AdminShell
      active="checkins"
      eyebrow={`${response.period} · ${roleLabels[response.role]}`}
      title={`${response.recipientName}님의 체크인`}
      description={`${formatKoreanDateTime(response.submittedAt)}에 제출된 응답입니다. 위험도와 연락 동의를 함께 확인한 뒤 필요한 지원만 기록하세요.`}
      actions={
        <>
          <Link href="/admin/checkins" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline outline-none hover:bg-[#f3f6f4] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
            <ArrowLeft size={17} aria-hidden="true" /> 목록으로
          </Link>
          {supportCase ? (
            <Link href={`/admin/support-cases/${encodeURIComponent(supportCase.id)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#176b52] px-4 text-sm font-extrabold text-white no-underline outline-none hover:bg-[#0d523e] focus-visible:ring-4 focus-visible:ring-[#176b52]/20">
              사건 상세 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ) : null}
        </>
      }
    >
      {isTest ? (
        <aside className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold leading-6 text-sky-900">
          테스트 데이터입니다. 운영 통계와 실제 이용자 후속 조치에서 제외하세요.
        </aside>
      ) : null}
      <ResponseDetailSections
        response={response}
        previousResponses={previousResponses}
        counterpart={counterpart}
        supportCase={supportCase}
      />

      {supportCase ? (
        <SectionCard className="mt-6" title="사건 조치" description="모든 조치는 관리자 ID와 함께 감사 로그에 기록되며, 메모는 사용자 화면에 노출되지 않습니다.">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <CaseStatusBadge status={supportCase.status} />
            <span className="text-sm text-[#60706a]">담당자 {supportCase.assignedAdminId ?? "미지정"}</span>
          </div>
          {canWriteCases ? (
            <CaseActions caseId={supportCase.id} status={supportCase.status} />
          ) : (
            <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">현재 계정에는 사건 조치를 기록할 CASE_WRITE 권한이 없습니다.</p>
          )}
        </SectionCard>
      ) : null}
    </AdminShell>
  );
}
