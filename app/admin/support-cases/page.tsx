import Link from "next/link";
import { AlertTriangle, ArrowRight, Filter, LockKeyhole, RotateCcw } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import {
  CaseStatusBadge,
  MetricCard,
  RiskBadge,
  SectionCard,
} from "@/components/admin/AdminPrimitives";
import {
  caseStatusLabels,
  formatKoreanDateTime,
  labels,
  roleLabels,
  shortId,
} from "@/components/admin/admin-labels";
import { requireAdminPage } from "@/lib/auth/admin";
import { minimizeDashboard } from "@/lib/admin/privacy";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import type {
  RiskLevel,
  SupportCaseStatus,
  SupportCaseSummary,
} from "@/lib/checkin/types";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

const priorityOrder: Record<RiskLevel, number> = {
  RED: 4,
  ORANGE: 3,
  YELLOW: 2,
  GREEN: 1,
};

function firstValue(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes("SUPER_ADMIN") || permissions.includes(permission);
}

function urgentScore(supportCase: SupportCaseSummary): number {
  return supportCase.priority === "RED" && supportCase.status === "UNACKNOWLEDGED" ? 1 : 0;
}

function isTestCase(
  supportCase: SupportCaseSummary,
  response?: { isTest?: boolean },
): boolean {
  return supportCase.isTest === true || response?.isTest === true;
}

const fieldClass =
  "mt-2 min-h-11 w-full rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-semibold text-[#27332e] outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15";

export default async function AdminSupportCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const rawParams = await searchParams;
  const filters = {
    priority: firstValue(rawParams.priority),
    status: firstValue(rawParams.status),
    match: firstValue(rawParams.match).trim(),
    assignee: firstValue(rawParams.assignee).trim(),
    includeTest: ["true", "only"].includes(firstValue(rawParams.includeTest))
      ? firstValue(rawParams.includeTest)
      : "",
  };
  const returnParams = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const returnPath = `/admin/support-cases${returnParams.size ? `?${returnParams}` : ""}`;
  const admin = await requireAdminPage("SAFETY_READ", returnPath);
  const canWriteCases = hasPermission(admin.permissions, "CASE_WRITE");
  const dashboard = minimizeDashboard(
    await (await getCheckinRepository()).getDashboard(),
    admin.permissions,
  );
  const responseById = new Map(dashboard.responses.map((response) => [response.id, response]));
  const visibleCases = dashboard.supportCases.filter((supportCase) => {
    const response = responseById.get(supportCase.responseId);
    const isTest = isTestCase(supportCase, response);
    if (filters.includeTest === "true") return true;
    if (filters.includeTest === "only") return isTest;
    return !isTest;
  });
  const cases = visibleCases
    .filter((supportCase) => !filters.priority || supportCase.priority === filters.priority)
    .filter((supportCase) => !filters.status || supportCase.status === filters.status)
    .filter(
      (supportCase) =>
        !filters.match || supportCase.matchId.toLowerCase().includes(filters.match.toLowerCase()),
    )
    .filter(
      (supportCase) =>
        !filters.assignee ||
        supportCase.assignedAdminId?.toLowerCase().includes(filters.assignee.toLowerCase()),
    )
    .sort(
      (a, b) =>
        urgentScore(b) - urgentScore(a) ||
        priorityOrder[b.priority] - priorityOrder[a.priority] ||
        b.createdAt.localeCompare(a.createdAt),
    );

  const statusCounts = visibleCases.reduce<Record<SupportCaseStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    {
      UNACKNOWLEDGED: 0,
      OPEN: 0,
      CONTACTED: 0,
      MEDIATING: 0,
      MONITORING: 0,
      RESOLVED: 0,
      CLOSED: 0,
    },
  );
  const activeCount = visibleCases.filter(
    (item) => !["RESOLVED", "CLOSED"].includes(item.status),
  ).length;

  return (
    <AdminShell
      active="cases"
      eyebrow="SAFETY OPERATIONS"
      title="지원 사건"
      description="안전·위험 응답에 대한 확인, 담당자 지정, 연락과 후속 조치를 관리합니다. RED 미확인 사건은 항상 가장 먼저 표시됩니다."
      actions={
        <Link href="/admin/checkins" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline outline-none hover:bg-[#f3f6f4] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
          체크인 응답 보기 <ArrowRight size={17} aria-hidden="true" />
        </Link>
      }
    >
      {statusCounts.UNACKNOWLEDGED > 0 ? (
        <aside className="mb-6 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-950">
          <AlertTriangle className="mt-0.5 shrink-0" size={21} aria-hidden="true" />
          <p className="m-0">
            <b className="block text-base">미확인 긴급 사건 {statusCounts.UNACKNOWLEDGED}건</b>
            응답자의 안전한 연락 방법을 먼저 확인하고, 확인 즉시 ‘확인 완료’로 기록하세요. 상대방에게는 어떤 메시지도 자동 발송되지 않습니다.
          </p>
        </aside>
      ) : null}

      {!canWriteCases ? (
        <aside className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <LockKeyhole className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <p className="m-0">현재 계정은 안전 사건을 열람할 수 있지만 조치를 기록할 권한은 없습니다.</p>
        </aside>
      ) : null}

      {filters.includeTest ? (
        <aside className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold leading-6 text-sky-900">
          {filters.includeTest === "only"
            ? "테스트 사건만 표시 중입니다. 모든 카드에 테스트 데이터 배지가 표시됩니다."
            : "운영 사건과 테스트 사건을 함께 표시 중입니다. 테스트 데이터 배지를 확인하세요."}
        </aside>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="전체 사건" value={visibleCases.length} />
        <MetricCard label="진행 중" value={activeCount} detail="해결·종료 제외" />
        <MetricCard label="미확인" value={statusCounts.UNACKNOWLEDGED} tone={statusCounts.UNACKNOWLEDGED ? "critical" : "default"} />
        <MetricCard label="해결·종료" value={statusCounts.RESOLVED + statusCounts.CLOSED} tone="accent" />
      </section>

      <SectionCard className="mt-6" title="사건 필터" description="현재 사건 요약 정보에서 우선순위, 상태, 매칭, 담당자를 검색합니다.">
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="text-sm font-bold text-[#34443d]">
            우선순위
            <select name="priority" defaultValue={filters.priority} className={fieldClass}>
              <option value="">전체 우선순위</option>
              <option value="RED">RED · 긴급</option>
              <option value="ORANGE">ORANGE · 우선 확인</option>
              <option value="YELLOW">YELLOW · 관찰</option>
              <option value="GREEN">GREEN · 안정</option>
            </select>
          </label>
          <label className="text-sm font-bold text-[#34443d]">
            사건 상태
            <select name="status" defaultValue={filters.status} className={fieldClass}>
              <option value="">전체 상태</option>
              {(Object.entries(caseStatusLabels) as Array<[SupportCaseStatus, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-[#34443d]">
            매칭 ID
            <input name="match" defaultValue={filters.match} placeholder="매칭 ID 검색" className={fieldClass} />
          </label>
          <label className="text-sm font-bold text-[#34443d]">
            담당 관리자 ID
            <input name="assignee" defaultValue={filters.assignee} placeholder="미지정 사건은 빈 값" className={fieldClass} />
          </label>
          <label className="text-sm font-bold text-[#34443d]">
            테스트 데이터
            <select name="includeTest" defaultValue={filters.includeTest} className={fieldClass}>
              <option value="">운영 데이터만 (기본)</option>
              <option value="true">운영 + 테스트 포함</option>
              <option value="only">테스트만</option>
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#176b52] px-5 text-sm font-extrabold text-white outline-none hover:bg-[#0d523e] focus-visible:ring-4 focus-visible:ring-[#176b52]/20">
              <Filter size={17} aria-hidden="true" /> 필터 적용
            </button>
            <Link href="/admin/support-cases" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#4f6058] no-underline outline-none hover:bg-[#f3f6f4] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
              <RotateCcw size={16} aria-hidden="true" /> 초기화
            </Link>
          </div>
        </form>
      </SectionCard>

      <SectionCard className="mt-6" title={`사건 목록 ${cases.length}건`} description="긴급 미확인 → 우선순위 → 최신 생성 순입니다.">
        {cases.length ? (
          <div className="grid gap-3">
            {cases.map((supportCase) => {
              const response = responseById.get(supportCase.responseId);
              const isUrgent = urgentScore(supportCase) === 1;
              const categories = response
                ? [...new Set(response.submission.issues.map((issue) => issue.category))]
                : [];

              return (
                <article key={supportCase.id} className={`grid gap-4 rounded-2xl border p-4 lg:grid-cols-[minmax(200px,1fr)_minmax(180px,.8fr)_minmax(200px,1fr)_auto] lg:items-center ${isUrgent ? "border-red-300 bg-red-50/70" : "border-[#dce5e1] bg-white"}`}>
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <RiskBadge risk={supportCase.priority} />
                      <CaseStatusBadge status={supportCase.status} />
                      {isTestCase(supportCase, response) ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-extrabold text-sky-800">테스트 데이터</span> : null}
                    </div>
                    <h3 className="m-0 text-base font-black">{response?.recipientName ?? "응답자"}</h3>
                    <p className="mb-0 mt-1 text-sm text-[#60706a]">{response ? roleLabels[response.role] : "역할 정보 없음"} · {formatKoreanDateTime(supportCase.createdAt)}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-bold text-[#718078]">매칭 / 사건</p>
                    <p className="mb-0 mt-1 text-sm font-semibold" title={supportCase.matchId}>{shortId(supportCase.matchId)}</p>
                    <p className="mb-0 mt-1 text-xs text-[#718078]" title={supportCase.id}>{shortId(supportCase.id)}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-bold text-[#718078]">신호 / 담당자</p>
                    <p className="mb-0 mt-1 text-sm font-semibold">{categories.length ? categories.map((category) => labels.category(category)).join(", ") : "응답 상세에서 확인"}</p>
                    <p className="mb-0 mt-1 text-xs text-[#718078]" title={supportCase.assignedAdminId}>{supportCase.assignedAdminId ? `담당 ${shortId(supportCase.assignedAdminId)}` : "담당자 미지정"}</p>
                  </div>
                  <Link href={`/admin/support-cases/${encodeURIComponent(supportCase.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#9bbcaf] bg-[#f4faf7] px-4 text-sm font-extrabold text-[#0d523e] no-underline outline-none hover:bg-[#e7f3ed] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
                    사건 열기 <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl bg-[#f6f8f7] px-5 py-12 text-center">
            <p className="m-0 font-bold text-[#405149]">조건에 맞는 지원 사건이 없습니다.</p>
            <p className="mb-0 mt-2 text-sm text-[#718078]">필터를 초기화하거나 다른 조건을 선택해 주세요.</p>
          </div>
        )}
      </SectionCard>
    </AdminShell>
  );
}
