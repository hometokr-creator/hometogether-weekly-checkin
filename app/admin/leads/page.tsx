import Link from "next/link";

import { LeadCsvImport } from "@/components/admin/LeadCsvImport";
import { AdminShell } from "@/components/admin/AdminShell";
import { MetricCard, SectionCard } from "@/components/admin/AdminPrimitives";
import { ViewingSlotForm } from "@/components/admin/ViewingSlotForm";
import {
  leadChurnReasonLabels,
  leadCustomerTypeLabels,
  leadOutcomeLabels,
  leadSourceLabels,
  leadStatusLabels,
} from "@/lib/leads/labels";
import {
  firstResponseMinutes,
  formatMinutes,
  isSlaCompliant,
  leadSlaStatus,
  nextLeadAction,
} from "@/lib/leads/metrics";
import { getLeadRepository } from "@/lib/leads/repository-factory";
import {
  leadChurnReasons,
  leadCustomerTypes,
  leadOutcomes,
  leadSources,
  leadStatuses,
  type LeadFilters,
} from "@/lib/leads/types";
import { requireAdminPage } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue): string | undefined {
  const result = Array.isArray(value) ? value[0] : value;
  return result?.trim() || undefined;
}

function hasPermission(permissions: readonly string[], permission: string) {
  return (
    permissions.includes("SUPER_ADMIN") || permissions.includes(permission)
  );
}

function asFilters(params: Record<string, SearchValue>): LeadFilters {
  return {
    from: first(params.from),
    to: first(params.to),
    source: first(params.source) as LeadFilters["source"],
    customerType: first(params.customerType) as LeadFilters["customerType"],
    region: first(params.region),
    term: first(params.term) as LeadFilters["term"],
    stage: first(params.stage) as LeadFilters["stage"],
    outcome: first(params.outcome) as LeadFilters["outcome"],
    churnReason: first(params.churnReason) as LeadFilters["churnReason"],
    assignedAdminId: first(params.assignedAdminId),
  };
}

function slaLabel(status: ReturnType<typeof leadSlaStatus>) {
  return {
    ON_TRACK: "진행 중",
    WARNING: "7분 경고",
    BREACHED: "10분 초과",
    ESCALATED: "15분 에스컬레이션",
    RESPONDED: "응답 완료",
  }[status];
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  const filters = asFilters(raw);
  const query = new URLSearchParams(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  );
  const returnPath = `/admin/leads${query.size ? `?${query}` : ""}`;
  const admin = await requireAdminPage("LEAD_READ", returnPath);
  const dashboard = await (await getLeadRepository()).getDashboard(filters);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const todaysLeads = dashboard.leads.filter(
    (lead) => lead.createdAt.slice(0, 10) === today,
  );
  const unanswered = dashboard.leads.filter(
    (lead) =>
      !lead.firstResponseAt && !["REGISTERED", "CHURNED"].includes(lead.status),
  );
  const answered = dashboard.leads.filter(
    (lead) => firstResponseMinutes(lead) !== undefined,
  );
  const compliant = answered.filter((lead) => isSlaCompliant(lead) === true);
  const preViewingChurn = dashboard.leads.filter(
    (lead) =>
      lead.outcome.outcome === "CHURNED" &&
      ["INQUIRY", "VIEWING_SCHEDULED"].includes(lead.outcome.churnStage ?? ""),
  );
  const viewingRequested = dashboard.leads.filter(
    (lead) => lead.viewingEvents.length > 0,
  );
  const viewingConfirmed = dashboard.leads.filter((lead) =>
    lead.viewingEvents.some((event) => Boolean(event.confirmedAt)),
  );
  const registered = dashboard.leads.filter(
    (lead) => lead.outcome.outcome === "REGISTERED",
  );
  const rate = (value: number, total = dashboard.leads.length) =>
    total ? `${Math.round((value / total) * 100)}%` : "—";
  const filterClass =
    "min-h-11 rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-semibold text-[#27332e] outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15";

  return (
    <AdminShell
      active="leads"
      eyebrow="KAKAO LEAD OPERATIONS"
      title="카카오 문의 리드"
      description="웹에서 문의를 먼저 만들고 카카오로 이동한 리드의 응답·매물·방문·등록·이탈 흐름을 관리합니다. 일반 카카오 채널 1:1 메시지는 수신하지 않습니다."
      actions={
        <>
          <Link
            href="/admin/leads/listings"
            className="inline-flex min-h-11 items-center rounded-xl border border-[#9bbcaf] bg-white px-4 text-sm font-extrabold text-[#0d523e] no-underline"
          >
            매물 조건 관리
          </Link>
          <Link
            href={`/admin/leads/analytics${query.size ? `?${query}` : ""}`}
            className="inline-flex min-h-11 items-center rounded-xl bg-[#176b52] px-4 text-sm font-extrabold text-white no-underline"
          >
            퍼널 분석 보기
          </Link>
        </>
      }
    >
      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
        aria-label="리드 KPI"
      >
        <MetricCard label="오늘 신규 문의" value={todaysLeads.length} />
        <MetricCard
          label="미응답 문의"
          value={unanswered.length}
          tone={unanswered.length ? "critical" : "default"}
        />
        <MetricCard
          label="10분 SLA 준수율"
          value={
            answered.length
              ? `${Math.round((compliant.length / answered.length) * 100)}%`
              : "—"
          }
          detail="첫 응답이 있는 리드 기준"
        />
        <MetricCard label="사전 이탈률" value={rate(preViewingChurn.length)} />
        <MetricCard label="방문 요청률" value={rate(viewingRequested.length)} />
        <MetricCard label="방문 확정률" value={rate(viewingConfirmed.length)} />
        <MetricCard
          label="등록 전환율"
          value={rate(registered.length)}
          tone="accent"
        />
      </section>

      <SectionCard
        className="mt-6"
        title="필터"
        description="기간, 유입·고객 유형, 지역·계약기간, 퍼널·결과·이탈사유와 담당자로 현재 리드를 좁힙니다."
      >
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className={filterClass}
            name="from"
            defaultValue={filters.from}
            type="date"
            aria-label="시작일"
          />
          <input
            className={filterClass}
            name="to"
            defaultValue={filters.to}
            type="date"
            aria-label="종료일"
          />
          <select
            className={filterClass}
            name="source"
            defaultValue={filters.source ?? ""}
          >
            <option value="">모든 유입채널</option>
            {leadSources.map((value) => (
              <option key={value} value={value}>
                {leadSourceLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={filterClass}
            name="customerType"
            defaultValue={filters.customerType ?? ""}
          >
            <option value="">모든 고객유형</option>
            {leadCustomerTypes.map((value) => (
              <option key={value} value={value}>
                {leadCustomerTypeLabels[value]}
              </option>
            ))}
          </select>
          <input
            className={filterClass}
            name="region"
            defaultValue={filters.region}
            placeholder="희망 지역"
          />
          <select
            className={filterClass}
            name="term"
            defaultValue={filters.term ?? ""}
          >
            <option value="">모든 희망 기간</option>
            <option value="ONE">1개월</option>
            <option value="TWO_TO_THREE">2~3개월</option>
            <option value="FOUR">4개월</option>
            <option value="FIVE_TO_SIX">5~6개월</option>
            <option value="OVER_SIX">6개월 초과</option>
          </select>
          <select
            className={filterClass}
            name="stage"
            defaultValue={filters.stage ?? ""}
          >
            <option value="">모든 퍼널 단계</option>
            {leadStatuses.map((value) => (
              <option key={value} value={value}>
                {leadStatusLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={filterClass}
            name="outcome"
            defaultValue={filters.outcome ?? ""}
          >
            <option value="">모든 결과</option>
            {leadOutcomes.map((value) => (
              <option key={value} value={value}>
                {leadOutcomeLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={filterClass}
            name="churnReason"
            defaultValue={filters.churnReason ?? ""}
          >
            <option value="">모든 이탈 사유</option>
            {leadChurnReasons.map((value) => (
              <option key={value} value={value}>
                {leadChurnReasonLabels[value]}
              </option>
            ))}
          </select>
          <select
            className={filterClass}
            name="assignedAdminId"
            defaultValue={filters.assignedAdminId ?? ""}
          >
            <option value="">모든 담당자</option>
            {dashboard.admins.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              className="min-h-11 rounded-xl bg-[#176b52] px-4 text-sm font-bold text-white"
              type="submit"
            >
              적용
            </button>
            <Link
              href="/admin/leads"
              className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] px-4 text-sm font-bold text-[#405149] no-underline"
            >
              초기화
            </Link>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        className="mt-6"
        title="리드 목록"
        description="상세 화면에서 첫 응답·방문 단계·등록 및 이탈 사유를 조치로 기록합니다."
      >
        {dashboard.leads.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
              <thead className="border-b border-[#dce5e1] text-xs text-[#60706a]">
                <tr>
                  <th className="px-3 py-3">식별자</th>
                  <th className="px-3 py-3">유입 시간</th>
                  <th className="px-3 py-3">최초 응답</th>
                  <th className="px-3 py-3">관심 매물</th>
                  <th className="px-3 py-3">희망 기간·지역</th>
                  <th className="px-3 py-3">현재 단계</th>
                  <th className="px-3 py-3">다음 액션</th>
                  <th className="px-3 py-3">SLA</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.leads.map((lead) => {
                  const sla = leadSlaStatus(lead);
                  return (
                    <tr
                      key={lead.id}
                      className="border-b border-[#edf2ef] align-top"
                    >
                      <td className="px-3 py-4 font-bold">
                        <Link
                          href={`/admin/leads/${lead.id}`}
                          className="text-[#0d523e] underline"
                        >
                          {lead.customerLabel ?? `리드 ${lead.id.slice(0, 8)}`}
                        </Link>
                        <small className="mt-1 block font-medium text-[#718078]">
                          {leadSourceLabels[lead.source]}
                        </small>
                      </td>
                      <td className="px-3 py-4">
                        {new Intl.DateTimeFormat("ko-KR", {
                          timeZone: "Asia/Seoul",
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(lead.createdAt))}
                      </td>
                      <td className="px-3 py-4">
                        {formatMinutes(firstResponseMinutes(lead))}
                      </td>
                      <td className="px-3 py-4">
                        {lead.originalListingName ?? "확인 필요"}
                      </td>
                      <td className="px-3 py-4">
                        {lead.desiredTermMonths
                          ? `${lead.desiredTermMonths}개월`
                          : "확인 필요"}
                        <small className="mt-1 block text-[#718078]">
                          {lead.desiredRegion ?? "지역 확인 필요"}
                        </small>
                      </td>
                      <td className="px-3 py-4 font-semibold">
                        {leadStatusLabels[lead.status]}
                      </td>
                      <td className="px-3 py-4">{nextLeadAction(lead)}</td>
                      <td
                        className={`px-3 py-4 font-bold ${sla === "BREACHED" || sla === "ESCALATED" ? "text-red-700" : sla === "WARNING" ? "text-amber-700" : "text-[#176b52]"}`}
                      >
                        {slaLabel(sla)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 rounded-xl bg-[#f4f7f5] p-5 text-sm font-semibold text-[#60706a]">
            현재 조건의 문의 리드가 없습니다. 카카오 이동 전{" "}
            <code>POST /api/leads</code>를 호출하면 이 목록에 생성됩니다.
          </p>
        )}
      </SectionCard>

      {hasPermission(admin.permissions, "LEAD_WRITE") ? (
        <SectionCard
          className="mt-6"
          title="방문 가능 슬롯"
          description="호스트가 미리 준 가능 시간을 운영자가 대신 등록할 수 있습니다. 공개 매물 화면은 이 API에서 현재 가능한 시간만 보여 줍니다."
        >
          <ViewingSlotForm listings={dashboard.availableListings} />
        </SectionCard>
      ) : null}
      {hasPermission(admin.permissions, "LEAD_IMPORT") ? (
        <SectionCard
          className="mt-6"
          title="과거 카카오 문의 CSV 가져오기"
          description="파일 해시와 source_system·record_id를 함께 저장해 같은 파일의 중복 적용을 막습니다."
        >
          <LeadCsvImport />
        </SectionCard>
      ) : null}
    </AdminShell>
  );
}
