import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { CaseActions } from "@/components/admin/CaseActions";
import {
  CaseStatusBadge,
  CriticalNotice,
  DefinitionList,
  RiskBadge,
  SectionCard,
} from "@/components/admin/AdminPrimitives";
import { ResponseDetailSections } from "@/components/admin/ResponseDetailSections";
import { formatKoreanDateTime } from "@/components/admin/admin-labels";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";

export const dynamic = "force-dynamic";

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes("SUPER_ADMIN") || permissions.includes(permission);
}

export default async function AdminSupportCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const returnPath = `/admin/support-cases/${encodeURIComponent(caseId)}`;
  const admin = await requireAdminPage("SAFETY_READ", returnPath);
  const repository = await getCheckinRepository();
  const supportCase = await repository.getSupportCase(caseId);

  if (!supportCase) notFound();

  const [response, dashboard] = await Promise.all([
    repository.getResponse(supportCase.responseId),
    repository.getDashboard(),
  ]);
  const previousResponses = response
    ? dashboard.responses
        .filter(
          (item) => item.participantId === response.participantId && item.id !== response.id,
        )
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    : [];
  const counterpart = response
    ? dashboard.responses
        .filter(
          (item) =>
            item.matchId === response.matchId &&
            item.participantId !== response.participantId &&
            item.period === response.period,
        )
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0]
    : undefined;
  const canWriteCases = hasPermission(admin.permissions, "CASE_WRITE");
  const isTest = Boolean(
    (supportCase as typeof supportCase & { isTest?: boolean }).isTest ||
      (response as (typeof response & { isTest?: boolean }) | null)?.isTest,
  );

  return (
    <AdminShell
      active="cases"
      eyebrow={`${supportCase.priority} PRIORITY`}
      title={response ? `${response.recipientName}님의 지원 사건` : "지원 사건 상세"}
      description="응답자의 안전한 연락 조건과 전달 동의를 확인하고, 수행한 조치를 순서대로 기록하세요."
      actions={
        <>
          <Link href="/admin/support-cases" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline outline-none hover:bg-[#f3f6f4] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
            <ArrowLeft size={17} aria-hidden="true" /> 사건 목록
          </Link>
          {response ? (
            <Link href={`/admin/checkins/${encodeURIComponent(response.id)}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#9bbcaf] bg-[#f4faf7] px-4 text-sm font-extrabold text-[#0d523e] no-underline outline-none hover:bg-[#e7f3ed] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
              원 응답 보기 <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ) : null}
        </>
      }
    >
      {isTest ? (
        <aside className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold leading-6 text-sky-900">
          테스트 사건입니다. 실제 이용자 연락·외부 알림·운영 통계에서 제외하세요.
        </aside>
      ) : null}
      {supportCase.status === "UNACKNOWLEDGED" ? (
        <CriticalNotice>
          <p className="m-0"><b className="block text-base">운영팀 확인이 아직 기록되지 않았습니다.</b>현재 위험 여부와 안전한 연락 수단을 먼저 검토한 후 ‘확인 완료’ 버튼을 눌러 확인 시각을 남기세요.</p>
        </CriticalNotice>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,.75fr)]">
        <SectionCard title="사건 상태" description="현재 저장소에 기록된 사건 요약입니다.">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <RiskBadge risk={supportCase.priority} />
            <CaseStatusBadge status={supportCase.status} />
          </div>
          <DefinitionList
            items={[
              { label: "사건 생성", value: formatKoreanDateTime(supportCase.createdAt) },
              { label: "운영팀 확인", value: formatKoreanDateTime(supportCase.acknowledgementAt) },
              { label: "첫 연락", value: formatKoreanDateTime(supportCase.firstContactAt) },
              { label: "해결 시각", value: formatKoreanDateTime(supportCase.resolvedAt) },
              { label: "담당 관리자", value: supportCase.assignedAdminId ?? "미지정" },
              { label: "해결 코드", value: supportCase.resolutionCode ?? "기록 없음" },
              { label: "매칭 ID", value: <span className="break-all font-mono text-xs">{supportCase.matchId}</span> },
              { label: "사건 ID", value: <span className="break-all font-mono text-xs">{supportCase.id}</span> },
              { label: "응답 ID", value: <span className="break-all font-mono text-xs">{supportCase.responseId}</span> },
            ]}
          />
        </SectionCard>

        <SectionCard title="사건 조치" description="메모는 운영팀 내부에만 저장됩니다.">
          {canWriteCases ? (
            <CaseActions caseId={supportCase.id} status={supportCase.status} />
          ) : (
            <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">현재 계정에는 사건 조치를 기록할 CASE_WRITE 권한이 없습니다.</p>
          )}
        </SectionCard>
      </div>

      {response ? (
        <div className="mt-6">
          <ResponseDetailSections
            response={response}
            previousResponses={previousResponses}
            counterpart={counterpart}
            supportCase={supportCase}
          />
        </div>
      ) : (
        <SectionCard className="mt-6" title="연결된 체크인 응답">
          <p className="m-0 text-sm text-[#718078]">연결된 응답을 찾을 수 없습니다. 데이터 정합성을 확인해 주세요.</p>
        </SectionCard>
      )}
    </AdminShell>
  );
}
