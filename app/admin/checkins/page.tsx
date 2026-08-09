import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Download,
  Filter,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";

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
import { getRecentCronOperations } from "@/lib/auth/cron-operations";
import {
  desiredActionOptions,
  issueCategoryOptions,
} from "@/lib/checkin/question-tree";
import { getCheckinRepository } from "@/lib/checkin/repository-factory";
import type {
  DashboardResponseRow,
  RiskLevel,
  SupportCaseStatus,
} from "@/lib/checkin/types";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;
type CheckinSearchParams = Promise<Record<string, SearchValue>>;

const riskOrder: Record<RiskLevel, number> = {
  RED: 4,
  ORANGE: 3,
  YELLOW: 2,
  GREEN: 1,
};

const cronJobLabels: Record<string, string> = {
  WEEKLY_CHECKINS: "주간 초대·발송",
  CHECKIN_REMINDERS: "미응답 리마인드",
  CHECKIN_OUTBOX: "CRM·관리자 연동",
};

const cronStatusLabels: Record<string, string> = {
  STARTED: "실행 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

function firstValue(value: SearchValue): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isSafetySensitive(response: DashboardResponseRow): boolean {
  return (
    response.riskLevel === "RED" ||
    Boolean(response.submission.safety) ||
    response.submission.issues.some((issue) => issue.category === "SAFETY")
  );
}

function isTestResponse(response: DashboardResponseRow): boolean {
  return (response as DashboardResponseRow & { isTest?: boolean }).isTest === true;
}

function hasPermission(permissions: readonly string[], permission: string): boolean {
  return permissions.includes("SUPER_ADMIN") || permissions.includes(permission);
}

function urgentScore(response: DashboardResponseRow): number {
  return response.riskLevel === "RED" && response.supportCase?.status === "UNACKNOWLEDGED"
    ? 1
    : 0;
}

function selectClassName() {
  return "min-h-11 w-full rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-semibold text-[#27332e] outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15";
}

export default async function AdminCheckinsPage({
  searchParams,
}: {
  searchParams: CheckinSearchParams;
}) {
  const rawParams = await searchParams;
  const filters = {
    week: firstValue(rawParams.week),
    role: firstValue(rawParams.role),
    risk: firstValue(rawParams.risk),
    match: firstValue(rawParams.match).trim(),
    responseState: firstValue(rawParams.responseState),
    category: firstValue(rawParams.category),
    desiredAction: firstValue(rawParams.desiredAction),
    caseStatus: firstValue(rawParams.caseStatus),
    assignee: firstValue(rawParams.assignee).trim(),
    from: firstValue(rawParams.from),
    to: firstValue(rawParams.to),
    includeTest: ["true", "only"].includes(firstValue(rawParams.includeTest))
      ? firstValue(rawParams.includeTest)
      : "",
  };
  const returnParams = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const returnPath = `/admin/checkins${returnParams.size ? `?${returnParams}` : ""}`;
  const admin = await requireAdminPage("CHECKIN_READ", returnPath);
  const canReadSafety = hasPermission(admin.permissions, "SAFETY_READ");
  const [dashboard, cronOperations] = await Promise.all([
    (await getCheckinRepository()).getDashboard(),
    getRecentCronOperations(),
  ]);

  const authorizedResponses = canReadSafety
    ? dashboard.responses
    : dashboard.responses.filter((response) => !isSafetySensitive(response));
  const availablePeriods = [...new Set([dashboard.period, ...authorizedResponses.map((item) => item.period)])]
    .filter(Boolean)
    .sort();

  const responses = authorizedResponses
    .filter((response) => {
      if (filters.includeTest === "true") return true;
      if (filters.includeTest === "only") return isTestResponse(response);
      return !isTestResponse(response);
    })
    .filter((response) => !filters.week || response.period === filters.week)
    .filter((response) => !filters.role || response.role === filters.role)
    .filter((response) => !filters.risk || response.riskLevel === filters.risk)
    .filter(
      (response) =>
        !filters.match || response.matchId.toLowerCase().includes(filters.match.toLowerCase()),
    )
    .filter((response) => {
      if (!filters.responseState || filters.responseState === "COMPLETED") return true;
      if (filters.responseState === "HAS_CASE") return Boolean(response.supportCase);
      if (filters.responseState === "NO_CASE") return !response.supportCase;
      if (filters.responseState === "PAIRED_MISMATCH") return response.pairedMismatch;
      return true;
    })
    .filter(
      (response) =>
        !filters.category ||
        response.submission.issues.some((issue) => issue.category === filters.category),
    )
    .filter(
      (response) =>
        !filters.desiredAction ||
        response.submission.issues.some(
          (issue) => issue.desiredAction === filters.desiredAction,
        ),
    )
    .filter(
      (response) =>
        !filters.caseStatus || response.supportCase?.status === filters.caseStatus,
    )
    .filter(
      (response) =>
        !filters.assignee ||
        response.supportCase?.assignedAdminId
          ?.toLowerCase()
          .includes(filters.assignee.toLowerCase()),
    )
    .filter(
      (response) =>
        (!filters.from || response.submittedAt.slice(0, 10) >= filters.from) &&
        (!filters.to || response.submittedAt.slice(0, 10) <= filters.to),
    )
    .sort(
      (a, b) =>
        urgentScore(b) - urgentScore(a) ||
        riskOrder[b.riskLevel] - riskOrder[a.riskLevel] ||
        b.submittedAt.localeCompare(a.submittedAt),
    );

  const overallResponseRate = dashboard.stats.targetCount
    ? Math.round((dashboard.stats.completedCount / dashboard.stats.targetCount) * 100)
    : 0;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const categoryEntries = Object.entries(dashboard.stats.categoryCounts)
    .filter(([category]) => canReadSafety || category !== "SAFETY")
    .sort((a, b) => b[1] - a[1]);

  return (
    <AdminShell
      active="checkins"
      eyebrow={dashboard.period}
      title="주간 체크인 대시보드"
      description="제출된 응답과 위험 신호를 확인합니다. RED 미확인 응답은 어떤 필터에서도 목록 최상단에 우선 배치됩니다."
      actions={
        <>
          {canReadSafety ? (
            <a
              href={`/api/admin/exports/checkin-responses${returnParams.size ? `?${returnParams}` : ""}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#9bbcaf] bg-white px-4 text-sm font-extrabold text-[#0d523e] no-underline outline-none hover:bg-[#e7f3ed] focus-visible:ring-4 focus-visible:ring-[#176b52]/20"
            >
              <Download size={17} aria-hidden="true" /> 현재 필터 CSV
            </a>
          ) : null}
          <Link
            href="/admin/support-cases"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#176b52] px-4 text-sm font-extrabold text-white no-underline outline-none hover:bg-[#0d523e] focus-visible:ring-4 focus-visible:ring-[#176b52]/20"
          >
            지원 사건 보기 <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </>
      }
    >
      {canReadSafety && dashboard.stats.unacknowledgedCritical > 0 ? (
        <Link
          href="/admin/support-cases?status=UNACKNOWLEDGED&priority=RED"
          className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950 no-underline outline-none focus-visible:ring-4 focus-visible:ring-red-100"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-700 text-white">
              <AlertTriangle size={21} aria-hidden="true" />
            </span>
            <span>
              <b className="block text-base">확인하지 않은 긴급 응답이 있습니다</b>
              <small className="mt-0.5 block text-sm text-red-800">
                {dashboard.stats.unacknowledgedCritical}건 · 상대방에게는 자동 전달되지 않았습니다.
              </small>
            </span>
          </span>
          <ArrowRight className="shrink-0" size={20} aria-hidden="true" />
        </Link>
      ) : null}

      {!canReadSafety ? (
        <aside className="mb-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <LockKeyhole className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
          <p className="m-0">
            현재 계정에는 안전 응답 열람 권한이 없어 RED·안전 답변과 지원 사건을 제외해 표시합니다.
          </p>
        </aside>
      ) : null}

      <p className="mb-3 mt-0 text-sm font-semibold text-[#60706a]">
        상단 운영 통계는 테스트 데이터를 제외합니다.
        {filters.includeTest ? " 아래 응답 목록에는 선택한 조건에 따라 테스트 데이터가 표시됩니다." : ""}
      </p>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6" aria-label="발송 및 응답 현황">
        <MetricCard label="발송 대상" value={dashboard.stats.targetCount} detail="이번 주 초대" />
        <MetricCard label="발송 성공" value={dashboard.stats.sentCount} detail="열람·완료 포함" />
        <MetricCard
          label="발송 실패"
          value={dashboard.stats.failedCount}
          detail="재시도 확인 필요"
          tone={dashboard.stats.failedCount ? "critical" : "default"}
        />
        <MetricCard label="전체 응답률" value={`${overallResponseRate}%`} detail={`${dashboard.stats.completedCount}건 완료`} tone="accent" />
        <MetricCard label="HOST 응답률" value={`${dashboard.stats.hostResponseRate}%`} detail="집주인" />
        <MetricCard label="GUEST 응답률" value={`${dashboard.stats.guestResponseRate}%`} detail="학생" />
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8" aria-label="위험도 및 운영 지표">
        {(["GREEN", "YELLOW", "ORANGE", "RED"] as const).map((risk) => (
          <MetricCard
            key={risk}
            label={`${risk} · ${risk === "GREEN" ? "안정" : risk === "YELLOW" ? "관찰" : risk === "ORANGE" ? "우선 확인" : "긴급"}`}
            value={risk === "RED" && !canReadSafety ? "제한" : dashboard.stats.riskCounts[risk]}
            tone={risk === "RED" && canReadSafety && dashboard.stats.riskCounts.RED ? "critical" : "default"}
          />
        ))}
        <MetricCard label="미확인 긴급" value={canReadSafety ? dashboard.stats.unacknowledgedCritical : "제한"} tone={canReadSafety && dashboard.stats.unacknowledgedCritical ? "critical" : "default"} />
        <MetricCard label="반복 불편" value={dashboard.stats.repeatedIssueCount} />
        <MetricCard label="2주 연속 미응답" value={dashboard.stats.consecutiveNonResponseCount} />
        <MetricCard label="응답 차이" value={dashboard.stats.pairedMismatchCount} />
      </section>

      <SectionCard
        className="mt-6"
        title="최근 Production Cron 실행 기록"
        description="운영 DB의 run과 메시지 delivery 상태를 집계합니다. 전화번호, 개인 링크와 응답 원문은 조회하지 않습니다."
      >
        {!cronOperations.configured ? (
          <p className="m-0 rounded-xl bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
            원격 Supabase 운영 연결이 없어 Cron 기록을 표시할 수 없습니다.
          </p>
        ) : cronOperations.requestId ? (
          <p className="m-0 rounded-xl bg-red-50 p-4 text-sm font-semibold leading-6 text-red-800">
            Cron 기록을 불러오지 못했습니다. 문의 코드: {cronOperations.requestId}
          </p>
        ) : (
          <div className="grid gap-5">
            {cronOperations.executions.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#dce5e1] text-xs font-extrabold text-[#718078]">
                      <th className="px-3 py-3">작업 / 시작</th>
                      <th className="px-3 py-3">결과</th>
                      <th className="px-3 py-3">대상</th>
                      <th className="px-3 py-3">성공</th>
                      <th className="px-3 py-3">실패</th>
                      <th className="px-3 py-3">완료</th>
                      <th className="px-3 py-3">요청 ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cronOperations.executions.map((execution) => (
                      <tr key={execution.requestId} className="border-b border-[#edf1ef] last:border-0">
                        <td className="px-3 py-4">
                          <b className="block">{cronJobLabels[execution.jobName] ?? execution.jobName}</b>
                          <span className="mt-1 flex items-center gap-1 text-xs text-[#718078]">
                            <Clock3 size={13} aria-hidden="true" /> {formatKoreanDateTime(execution.startedAt)}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <b className={execution.status === "FAILED" ? "text-red-700" : execution.status === "COMPLETED" ? "text-emerald-700" : "text-amber-800"}>
                            {cronStatusLabels[execution.status] ?? execution.status}
                          </b>
                          {execution.errorCode ? <span className="mt-1 block font-mono text-xs text-red-700">{execution.errorCode}</span> : null}
                        </td>
                        <td className="px-3 py-4 font-bold">{execution.targetCount}건</td>
                        <td className="px-3 py-4 font-bold text-emerald-700">{execution.sentCount}건</td>
                        <td className={`px-3 py-4 font-black ${execution.failedCount ? "text-red-700" : "text-[#60706a]"}`}>{execution.failedCount}건</td>
                        <td className="px-3 py-4 text-xs text-[#60706a]">{execution.finishedAt ? formatKoreanDateTime(execution.finishedAt) : "진행 중"}</td>
                        <td className="px-3 py-4 font-mono text-xs text-[#60706a]" title={execution.requestId}>{shortId(execution.requestId)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="m-0 rounded-xl bg-[#f6f8f7] p-4 text-sm text-[#60706a]">
                아직 기록된 Production Cron 실행이 없습니다.
              </p>
            )}

            {cronOperations.runs.length ? (
              <details className="rounded-xl border border-[#dce5e1] bg-[#f8faf9] p-4">
                <summary className="cursor-pointer font-bold text-[#405149]">주차별 delivery 상태 교차 확인</summary>
                <div className="mt-4 grid gap-2">
                  {cronOperations.runs.map((run) => (
                    <div key={run.id} className="grid gap-2 rounded-xl bg-white p-3 text-sm sm:grid-cols-[1.4fr_repeat(4,.65fr)]">
                      <span><b className="block">{run.weekStart} ~ {run.weekEnd}</b><small className="text-[#718078]">DB {run.databaseStatus}</small></span>
                      <span>대상 <b>{run.targetCount}</b></span>
                      <span>최초 <b>{run.initialSentCount}</b></span>
                      <span>리마인드 <b>{run.reminderSentCount}</b></span>
                      <span className={run.failedCount ? "text-red-700" : ""}>실패 <b>{run.failedCount}</b></span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}
      </SectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="응답 필터"
          description={`현재 ${activeFilterCount}개 필터 적용 · 저장소가 제공하는 제출 완료 응답 안에서 필터링합니다.`}
        >
          <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" method="get">
            <label className="text-sm font-bold text-[#34443d]">
              주차
              <select name="week" defaultValue={filters.week} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 주차</option>
                {availablePeriods.map((period) => <option key={period} value={period}>{period}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              역할
              <select name="role" defaultValue={filters.role} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 역할</option>
                <option value="HOST">집주인</option>
                <option value="GUEST">학생</option>
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              위험도
              <select name="risk" defaultValue={filters.risk} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 위험도</option>
                <option value="GREEN">GREEN</option>
                <option value="YELLOW">YELLOW</option>
                <option value="ORANGE">ORANGE</option>
                {canReadSafety ? <option value="RED">RED</option> : null}
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              매칭 ID
              <input name="match" defaultValue={filters.match} placeholder="매칭 ID 검색" className={`mt-2 ${selectClassName()}`} />
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              응답 상태
              <select name="responseState" defaultValue={filters.responseState} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 완료 응답</option>
                <option value="HAS_CASE">지원 사건 생성</option>
                <option value="NO_CASE">일반 기록</option>
                <option value="PAIRED_MISMATCH">같은 집 응답 차이</option>
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              불편 카테고리
              <select name="category" defaultValue={filters.category} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 카테고리</option>
                {issueCategoryOptions.filter((option) => canReadSafety || option.value !== "SAFETY").map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              지원 요청
              <select name="desiredAction" defaultValue={filters.desiredAction} className={`mt-2 ${selectClassName()}`}>
                <option value="">전체 지원 요청</option>
                {desiredActionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              사건 상태
              <select name="caseStatus" defaultValue={filters.caseStatus} disabled={!canReadSafety} className={`mt-2 ${selectClassName()} disabled:bg-[#eef1ef] disabled:text-[#87938d]`}>
                <option value="">전체 사건 상태</option>
                {(Object.entries(caseStatusLabels) as Array<[SupportCaseStatus, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              담당 관리자 ID
              <input name="assignee" defaultValue={filters.assignee} disabled={!canReadSafety} placeholder="담당자 ID 검색" className={`mt-2 ${selectClassName()} disabled:bg-[#eef1ef] disabled:text-[#87938d]`} />
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              테스트 데이터
              <select name="includeTest" defaultValue={filters.includeTest} className={`mt-2 ${selectClassName()}`}>
                <option value="">운영 데이터만 (기본)</option>
                <option value="true">운영 + 테스트 포함</option>
                <option value="only">테스트만</option>
              </select>
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              제출 시작일
              <input type="date" name="from" defaultValue={filters.from} className={`mt-2 ${selectClassName()}`} />
            </label>
            <label className="text-sm font-bold text-[#34443d]">
              제출 종료일
              <input type="date" name="to" min={filters.from || undefined} defaultValue={filters.to} className={`mt-2 ${selectClassName()}`} />
            </label>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#176b52] px-5 text-sm font-extrabold text-white outline-none hover:bg-[#0d523e] focus-visible:ring-4 focus-visible:ring-[#176b52]/20">
                <Filter size={17} aria-hidden="true" /> 필터 적용
              </button>
              <Link href="/admin/checkins" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#4f6058] no-underline outline-none hover:bg-[#f3f6f4] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
                <RotateCcw size={16} aria-hidden="true" /> 초기화
              </Link>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="카테고리별 건수" description="한 응답에 여러 불편이 있으면 각각 집계됩니다.">
          {categoryEntries.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {categoryEntries.map(([category, count]) => (
                <li key={category} className="flex min-h-10 items-center justify-between gap-4 rounded-xl bg-[#f5f8f6] px-3 text-sm">
                  <span className="font-semibold text-[#405149]">{labels.category(category)}</span>
                  <b className="text-[#176b52]">{count}건</b>
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-sm text-[#718078]">집계된 불편 카테고리가 없습니다.</p>}
        </SectionCard>
      </div>

      <SectionCard
        className="mt-6"
        title={`제출된 응답 ${responses.length}건`}
        description="긴급 미확인 → 위험도 → 최신 제출 순입니다. 상대방에게 답변이 자동 공유되지는 않습니다."
      >
        {responses.length ? (
          <div className="grid gap-3">
            {responses.map((response) => {
              const categories = [...new Set(response.submission.issues.map((issue) => issue.category))];
              const isUrgent = urgentScore(response) === 1;

              return (
                <article key={response.id} className={`grid gap-4 rounded-2xl border p-4 lg:grid-cols-[minmax(210px,1.1fr)_minmax(180px,.8fr)_minmax(180px,1fr)_auto] lg:items-center ${isUrgent ? "border-red-300 bg-red-50/70" : "border-[#dce5e1] bg-white"}`}>
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <RiskBadge risk={response.riskLevel} />
                      {isTestResponse(response) ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-extrabold text-sky-800">테스트 데이터</span> : null}
                      {response.pairedMismatch ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">응답 차이</span> : null}
                    </div>
                    <h3 className="m-0 text-base font-black">{response.recipientName}</h3>
                    <p className="mb-0 mt-1 text-sm text-[#60706a]">{roleLabels[response.role]} · {formatKoreanDateTime(response.submittedAt)}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-bold text-[#718078]">매칭 / 주차</p>
                    <p className="mb-0 mt-1 text-sm font-semibold" title={response.matchId}>{shortId(response.matchId)}</p>
                    <p className="mb-0 mt-1 text-xs text-[#718078]">{response.period}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-bold text-[#718078]">불편 / 사건</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {categories.length ? categories.map((category) => <span key={category} className="rounded-lg bg-[#eef3f0] px-2 py-1 text-xs font-semibold text-[#405149]">{labels.category(category)}</span>) : response.submission.safety || response.submission.overallStatus === "NEED_HELP_NOW" ? <span className="text-sm font-semibold text-red-700">안전 확인 응답</span> : <span className="text-sm text-[#718078]">특별한 불편 없음</span>}
                    </div>
                    {response.supportCase ? <div className="mt-2"><CaseStatusBadge status={response.supportCase.status} /></div> : null}
                  </div>
                  <Link href={`/admin/checkins/${encodeURIComponent(response.id)}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#9bbcaf] bg-[#f4faf7] px-4 text-sm font-extrabold text-[#0d523e] no-underline outline-none hover:bg-[#e7f3ed] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
                    상세 보기 <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl bg-[#f6f8f7] px-5 py-12 text-center">
            <p className="m-0 font-bold text-[#405149]">조건에 맞는 제출 응답이 없습니다.</p>
            <p className="mb-0 mt-2 text-sm text-[#718078]">필터를 초기화하거나 다른 조건을 선택해 주세요.</p>
          </div>
        )}
      </SectionCard>
    </AdminShell>
  );
}
