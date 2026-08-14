import Link from "next/link";
import { notFound } from "next/navigation";

import { LeadActions } from "@/components/admin/LeadActions";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  DefinitionList,
  SectionCard,
} from "@/components/admin/AdminPrimitives";
import { requireAdminPage } from "@/lib/auth/admin";
import {
  leadChurnReasonLabels,
  leadCustomerTypeLabels,
  leadOutcomeLabels,
  leadSourceLabels,
  leadStatusLabels,
} from "@/lib/leads/labels";
import {
  confirmationToViewingMinutes,
  firstResponseMinutes,
  formatMinutes,
  inquiryToViewingRequestMinutes,
  totalLeadToRegistrationHours,
  viewingRequestToConfirmationMinutes,
} from "@/lib/leads/metrics";
import { getLeadRepository } from "@/lib/leads/repository-factory";

export const dynamic = "force-dynamic";

export default async function AdminLeadDetailPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  const admin = await requireAdminPage("LEAD_READ", `/admin/leads/${leadId}`);
  const repository = await getLeadRepository();
  const [lead, dashboard] = await Promise.all([
    repository.getLead(leadId),
    repository.getDashboard(),
  ]);
  if (!lead) notFound();
  const canWrite =
    admin.permissions.includes("SUPER_ADMIN") ||
    admin.permissions.includes("LEAD_WRITE");
  const date = (value?: string) =>
    value
      ? new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(value))
      : "확인 필요";

  return (
    <AdminShell
      active="leads"
      eyebrow={leadSourceLabels[lead.source]}
      title={lead.customerLabel ?? `리드 ${lead.id.slice(0, 8)}`}
      description="개인 대화 원문을 저장하지 않고, 운영에 필요한 단계와 결과만 기록합니다."
      actions={
        <Link
          href="/admin/leads"
          className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline"
        >
          목록으로
        </Link>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-6">
          <SectionCard title="문의·희망 조건">
            <DefinitionList
              items={[
                {
                  label: "고객 유형",
                  value: leadCustomerTypeLabels[lead.customerType],
                },
                { label: "현재 단계", value: leadStatusLabels[lead.status] },
                { label: "유입", value: leadSourceLabels[lead.source] },
                { label: "문의 시간", value: date(lead.createdAt) },
                {
                  label: "희망 지역",
                  value: lead.desiredRegion ?? "확인 필요",
                },
                {
                  label: "희망 계약기간",
                  value: lead.desiredTermMonths
                    ? `${lead.desiredTermMonths}개월`
                    : "확인 필요",
                },
                {
                  label: "월 예산",
                  value:
                    lead.budgetMonthly?.toLocaleString("ko-KR") ?? "확인 필요",
                },
                {
                  label: "보증금 예산",
                  value:
                    lead.budgetDeposit?.toLocaleString("ko-KR") ?? "확인 필요",
                },
                {
                  label: "관심 매물",
                  value: lead.originalListingName ?? "확인 필요",
                },
                {
                  label: "원매물 가능 여부",
                  value:
                    lead.originalListingAvailable === undefined
                      ? "확인 필요"
                      : lead.originalListingAvailable
                        ? "가능"
                        : "불가",
                },
                {
                  label: "대체매물 사용",
                  value: lead.alternativeListingUsed ? "사용" : "미사용",
                },
                {
                  label: "필수 조건",
                  value: lead.mustHave.length
                    ? lead.mustHave.join(", ")
                    : "확인 필요",
                },
              ]}
            />
          </SectionCard>
          <SectionCard title="자동 계산 시간 지표">
            <DefinitionList
              items={[
                {
                  label: "최초 응답",
                  value: formatMinutes(firstResponseMinutes(lead)),
                },
                {
                  label: "문의 → 방문 요청",
                  value: formatMinutes(inquiryToViewingRequestMinutes(lead)),
                },
                {
                  label: "방문 요청 → 확정",
                  value: formatMinutes(
                    viewingRequestToConfirmationMinutes(lead),
                  ),
                },
                {
                  label: "방문 확정 → 실제 방문",
                  value: formatMinutes(confirmationToViewingMinutes(lead)),
                },
                {
                  label: "문의 → 등록",
                  value:
                    totalLeadToRegistrationHours(lead) === undefined
                      ? "—"
                      : `${totalLeadToRegistrationHours(lead)?.toFixed(1)}시간`,
                },
              ]}
            />
          </SectionCard>
          <SectionCard title="방문 이력">
            <div className="grid gap-3">
              {lead.viewingEvents.length ? (
                lead.viewingEvents.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-xl bg-[#f4f7f5] p-4 text-sm"
                  >
                    <b>
                      {event.listingId === lead.originalListingId
                        ? (lead.originalListingName ?? "원매물")
                        : "대체 매물"}
                    </b>
                    <p className="mb-0 mt-2">
                      요청 {date(event.requestedAt)} · 확정{" "}
                      {date(event.confirmedAt)} · 방문 {date(event.viewingAt)}
                    </p>
                    {event.cancelledAt ? (
                      <p className="mb-0 mt-1 text-red-700">
                        취소 {date(event.cancelledAt)} ·{" "}
                        {event.cancellationReason ?? "사유 확인 필요"}
                      </p>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="m-0 text-sm text-[#60706a]">
                  아직 방문 요청이 없습니다.
                </p>
              )}
            </div>
          </SectionCard>
          <SectionCard title="결과">
            <DefinitionList
              items={[
                {
                  label: "결과",
                  value: leadOutcomeLabels[lead.outcome.outcome],
                },
                {
                  label: "이탈 사유",
                  value: lead.outcome.churnReason
                    ? leadChurnReasonLabels[lead.outcome.churnReason]
                    : "—",
                },
                {
                  label: "이탈 메모",
                  value: lead.outcome.churnReasonNote ?? "—",
                },
                { label: "종료 시간", value: date(lead.outcome.closedAt) },
              ]}
            />
          </SectionCard>
        </div>
        {canWrite ? (
          <SectionCard
            title="운영 조치"
            description="민감 조치는 MFA 인증 후 기록됩니다."
          >
            <LeadActions lead={lead} listings={dashboard.availableListings} />
          </SectionCard>
        ) : (
          <SectionCard title="운영 조치">
            <p className="m-0 text-sm text-[#60706a]">
              현재 계정에는 리드 변경 권한이 없습니다.
            </p>
          </SectionCard>
        )}
      </div>
    </AdminShell>
  );
}
