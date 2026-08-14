import Link from "next/link";

import { AdminShell } from "@/components/admin/AdminShell";
import { MetricCard, SectionCard } from "@/components/admin/AdminPrimitives";
import { requireAdminPage } from "@/lib/auth/admin";
import { leadChurnReasonLabels } from "@/lib/leads/labels";
import { getLeadRepository } from "@/lib/leads/repository-factory";
import type { LeadFilters } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

function first(value: SearchValue): string | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item?.trim() || undefined;
}

function readFilters(params: Record<string, SearchValue>): LeadFilters {
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

function percentage(value: number) {
  return `${value.toFixed(1)}%`;
}

export default async function LeadAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams(
    Object.entries(raw)
      .map(([key, value]) => [key, first(value)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  await requireAdminPage(
    "LEAD_ANALYTICS",
    `/admin/leads/analytics${query.size ? `?${query}` : ""}`,
  );
  const analytics = await (
    await getLeadRepository()
  ).getAnalytics(readFilters(raw));

  return (
    <AdminShell
      active="leads"
      eyebrow="LEAD ANALYTICS"
      title="문의 퍼널 분석"
      description="문의부터 매물 클릭, 방문, 등록과 이탈 이유를 동일한 기준으로 비교합니다. 전환율의 분모는 현재 필터의 문의 리드입니다."
      actions={
        <Link
          href={`/admin/leads${query.size ? `?${query}` : ""}`}
          className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline"
        >
          리드 목록으로
        </Link>
      }
    >
      <SectionCard
        title="퍼널"
        description="문의 → 매물 클릭 → 방문 요청 → 방문 확정 → 실제 방문 → 등록"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {analytics.funnel.map((stage) => (
            <MetricCard
              key={stage.stage}
              label={stage.stage}
              value={stage.count}
              detail={`전환율 ${percentage(stage.conversionRate)}`}
              tone={stage.stage === "등록" ? "accent" : "default"}
            />
          ))}
        </div>
      </SectionCard>
      <SectionCard
        className="mt-6"
        title="SLA 분석"
        description="첫 응답 기준입니다. 미응답 리드는 평균·중앙값과 전환 비교에서 제외됩니다."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="10분 이내 응답 고객 등록률"
            value={percentage(analytics.sla.withinTenMinuteConversionRate)}
            tone="accent"
          />
          <MetricCard
            label="10분 초과 응답 고객 등록률"
            value={percentage(analytics.sla.overTenMinuteConversionRate)}
          />
          <MetricCard
            label="평균 최초 응답 시간"
            value={
              analytics.sla.averageFirstResponseMinutes === undefined
                ? "—"
                : `${analytics.sla.averageFirstResponseMinutes}분`
            }
          />
          <MetricCard
            label="중앙값 최초 응답 시간"
            value={
              analytics.sla.medianFirstResponseMinutes === undefined
                ? "—"
                : `${analytics.sla.medianFirstResponseMinutes.toFixed(1)}분`
            }
          />
        </div>
      </SectionCard>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="원매물 vs 대체매물"
          description="원매물 가능 여부와 대체매물 제안 여부를 리드 생성 시점·운영 조치로 남겨 비교합니다."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard
              label="원매물 가능 고객 등록률"
              value={percentage(
                analytics.listingComparison.originalAvailableRegistrationRate,
              )}
            />
            <MetricCard
              label="원매물 불가 후 대체매물 고객 등록률"
              value={percentage(
                analytics.listingComparison.alternativeRegistrationRate,
              )}
            />
          </div>
        </SectionCard>
        <SectionCard
          title="이탈 원인"
          description="고객 또는 운영자가 확정한 이탈 사유입니다."
        >
          {analytics.churnReasons.length ? (
            <ul className="m-0 grid list-none gap-2 p-0">
              {analytics.churnReasons.map((item) => (
                <li
                  key={item.reason}
                  className="flex items-center justify-between rounded-xl bg-[#f4f7f5] px-4 py-3 text-sm"
                >
                  <span className="font-bold">
                    {leadChurnReasonLabels[item.reason]}
                  </span>
                  <span>
                    {item.count}건 · {percentage(item.rate)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-[#60706a]">
              기록된 이탈 사유가 없습니다.
            </p>
          )}
        </SectionCard>
      </div>
      <SectionCard
        className="mt-6"
        title="희망 계약기간"
        description="기간별 문의수, 방문률, 등록률, 이탈률입니다."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="border-b border-[#dce5e1] text-xs text-[#60706a]">
              <tr>
                <th className="p-3">희망 기간</th>
                <th className="p-3">문의수</th>
                <th className="p-3">방문률</th>
                <th className="p-3">등록률</th>
                <th className="p-3">이탈률</th>
              </tr>
            </thead>
            <tbody>
              {analytics.termBuckets.map((item) => (
                <tr className="border-b border-[#edf2ef]" key={item.label}>
                  <td className="p-3 font-bold">{item.label}</td>
                  <td className="p-3">{item.inquiryCount}</td>
                  <td className="p-3">{percentage(item.viewingRate)}</td>
                  <td className="p-3">{percentage(item.registrationRate)}</td>
                  <td className="p-3">{percentage(item.churnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      <SectionCard
        className="mt-6"
        title="미충족 수요 지역"
        description="원하는 지역 매물이 없거나 위치 때문에 이탈한 리드를 집계합니다."
      >
        {analytics.unmetDemand.length ? (
          <ol className="m-0 grid gap-2 pl-6">
            {analytics.unmetDemand.map((item) => (
              <li
                key={item.region}
                className="rounded-xl bg-[#f4f7f5] px-3 py-2 text-sm font-semibold"
              >
                {item.region}{" "}
                <span className="font-normal text-[#60706a]">
                  · {item.count}건
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-sm text-[#60706a]">
            미충족 수요로 확정된 이탈 데이터가 없습니다.
          </p>
        )}
      </SectionCard>
    </AdminShell>
  );
}
