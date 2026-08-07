import Link from "next/link";
import { ArrowRight, Clock3, ShieldAlert } from "lucide-react";

import type {
  DashboardResponseRow,
  SupportCaseSummary,
} from "@/lib/checkin/types";

import {
  CaseStatusBadge,
  CriticalNotice,
  DefinitionList,
  PrivacyWarning,
  RiskBadge,
  SectionCard,
} from "./AdminPrimitives";
import {
  caseActionLabels,
  caseStatusLabels,
  formatKoreanDateTime,
  labels,
  riskReasonLabel,
  roleLabels,
  shortId,
  subcategoryLabel,
} from "./admin-labels";

type ResponseDetailSectionsProps = {
  response: DashboardResponseRow;
  previousResponses: DashboardResponseRow[];
  counterpart?: DashboardResponseRow;
  supportCase?: SupportCaseSummary;
};

export function ResponseDetailSections({
  response,
  previousResponses,
  counterpart,
  supportCase,
}: ResponseDetailSectionsProps) {
  const submission = response.submission;

  return (
    <div className="grid gap-6">
      {response.riskLevel === "RED" ? (
        <CriticalNotice>
          <p className="m-0">
            <b className="block text-base">긴급 위험 신호가 포함된 응답입니다.</b>
            먼저 현재 위험 여부와 안전한 연락 수단을 확인하세요. 상대방에게는 자동 연락하거나 내용을
            전달하지 않습니다.
          </p>
        </CriticalNotice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="응답자와 매칭" description="운영 지원에 필요한 최소 식별 정보입니다.">
          <DefinitionList
            items={[
              { label: "응답자", value: response.recipientName },
              { label: "역할", value: roleLabels[response.role] },
              { label: "체크인 기간", value: response.period },
              { label: "제출 시각", value: formatKoreanDateTime(response.submittedAt) },
              {
                label: "매칭 ID",
                value: <span className="break-all font-mono text-xs" title={response.matchId}>{response.matchId}</span>,
              },
              {
                label: "참여자 ID",
                value: <span className="break-all font-mono text-xs" title={response.participantId}>{response.participantId}</span>,
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="평가와 위험도" description={`질문지 ${submission.questionnaireVersion} 기준 서버 판정입니다.`}>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <RiskBadge risk={response.riskLevel} />
            {response.pairedMismatch ? <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">같은 집 응답 차이</span> : null}
          </div>
          <DefinitionList
            items={[
              { label: "전체 평가", value: labels.overallStatus(submission.overallStatus) },
              { label: "불편 발생", value: labels.issueStatus(submission.issueStatus) },
            ]}
          />
          <div className="mt-5 border-t border-[#e3eae6] pt-5">
            <p className="m-0 text-xs font-extrabold tracking-[0.04em] text-[#718078]">위험도 판정 사유</p>
            {response.riskReasons.length ? (
              <ul className="mb-0 mt-2 grid gap-2 pl-5 text-sm leading-6 text-[#34443d]">
                {response.riskReasons.map((reason, index) => <li key={`${reason}-${index}`}>{riskReasonLabel(reason)}</li>)}
              </ul>
            ) : <p className="mb-0 mt-2 text-sm text-[#718078]">별도 위험 사유가 없습니다.</p>}
          </div>
        </SectionCard>
      </div>

      {submission.positivePoints.length ? (
        <SectionCard title="이번 주 괜찮았던 점">
          <div className="flex flex-wrap gap-2">
            {submission.positivePoints.map((point) => <span key={point} className="rounded-xl bg-[#eef8f3] px-3 py-2 text-sm font-bold text-[#176b52]">{labels.positivePoint(point)}</span>)}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title={`불편 상세 ${submission.issues.length}건`} description="응답자가 가장 먼저 해결하고 싶은 순서로 저장된 항목입니다.">
        {submission.issues.length ? (
          <div className="grid gap-4">
            {submission.issues.map((issue, index) => (
              <article key={`${issue.category}-${issue.subcategory}-${index}`} className="rounded-2xl border border-[#dce5e1] bg-[#f9fbfa] p-4 sm:p-5">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="m-0 text-xs font-extrabold text-[#176b52]">불편 {index + 1}</p>
                    <h3 className="mb-0 mt-1 text-lg font-black">{labels.category(issue.category)} · {subcategoryLabel(issue.category, issue.subcategory)}</h3>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-black ${issue.severity >= 5 ? "bg-red-100 text-red-800" : issue.severity >= 4 ? "bg-orange-100 text-orange-900" : issue.severity >= 3 ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>
                    영향도 {issue.severity}/5
                  </span>
                </div>
                <DefinitionList
                  items={[
                    { label: "발생 빈도", value: labels.frequency(issue.frequency) },
                    { label: "생활 영향도", value: labels.severity(issue.severity) },
                    { label: "상대방과 대화", value: labels.discussionStatus(issue.discussionStatus) },
                    { label: "원하는 지원", value: labels.desiredAction(issue.desiredAction) },
                    { label: "추가 설명 방식", value: issue.clarificationPreference ? issue.clarificationPreference === "CONTACT_TO_EXPLAIN" ? "운영팀 연락 시 설명" : "별도 설명 없이 기록" : "선택 없음" },
                    { label: "선택적 추가 설명", value: issue.additionalNote || "작성하지 않음" },
                  ]}
                />
              </article>
            ))}
          </div>
        ) : <p className="m-0 text-sm text-[#718078]">등록된 불편 항목이 없습니다.</p>}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="전달 동의와 연락 선호" description="어떤 연락보다 먼저 응답자의 선택을 확인하세요.">
          <DefinitionList
            items={[
              { label: "전달 동의", value: labels.disclosurePreference(submission.disclosurePreference) },
              { label: "연락 방식", value: labels.contactMethod(submission.contactMethod) },
              { label: "연락 시간", value: labels.contactWindow(submission.contactWindow) },
            ]}
          />
        </SectionCard>

        {submission.safety ? (
          <SectionCard title="안전 확인 응답" description="SAFETY_READ 권한이 필요한 민감 정보입니다." className="border-red-200">
            <div className="mb-4 flex items-center gap-2 text-red-800">
              <ShieldAlert size={20} aria-hidden="true" />
              <b className="text-sm">안전한 연락 조건부터 확인</b>
            </div>
            <DefinitionList
              items={[
                { label: "현재 즉시 위험", value: labels.immediateDanger(submission.safety.immediateDanger) },
                { label: "안전한 연락 방법", value: labels.safeToContact(submission.safety.safeToContact) },
                { label: "현재 안전한 공간", value: labels.safeLocation(submission.safety.safeLocation) },
              ]}
            />
          </SectionCard>
        ) : (
          <SectionCard title="안전 확인 응답">
            <p className="m-0 text-sm leading-6 text-[#718078]">이 응답에서는 별도 안전 분기가 진행되지 않았습니다.</p>
          </SectionCard>
        )}
      </div>

      <SectionCard title="같은 집 상대방의 이번 주 상태" description="사용자 화면에는 제공되지 않는 관리자 비교 정보입니다.">
        <PrivacyWarning />
        {counterpart ? (
          <div className="mt-4 flex flex-col justify-between gap-4 rounded-2xl border border-[#dce5e1] bg-[#f8faf9] p-4 sm:flex-row sm:items-center">
            <div>
              <p className="m-0 font-black">{counterpart.recipientName} · {roleLabels[counterpart.role]}</p>
              <p className="mb-0 mt-1 text-sm text-[#60706a]">{counterpart.period} · {formatKoreanDateTime(counterpart.submittedAt)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge risk={counterpart.riskLevel} />
              <Link href={`/admin/checkins/${encodeURIComponent(counterpart.id)}`} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-bold text-[#405149] no-underline outline-none hover:bg-[#eef3f0] focus-visible:ring-4 focus-visible:ring-[#176b52]/15">
                상대 응답 열기 <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
        ) : <p className="mb-0 mt-4 text-sm text-[#718078]">같은 주차에 제출된 상대방 응답이 없습니다.</p>}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="이전 체크인 추이" description="현재 저장소에 연결된 이전 제출 응답 기준입니다.">
          {previousResponses.length ? (
            <ol className="m-0 grid list-none gap-3 p-0">
              {previousResponses.slice(0, 6).map((previous) => (
                <li key={previous.id} className="flex items-center justify-between gap-4 rounded-xl border border-[#e1e8e4] p-3">
                  <div>
                    <p className="m-0 text-sm font-bold">{previous.period}</p>
                    <p className="mb-0 mt-1 text-xs text-[#718078]">{formatKoreanDateTime(previous.submittedAt)}</p>
                  </div>
                  <RiskBadge risk={previous.riskLevel} />
                </li>
              ))}
            </ol>
          ) : <p className="m-0 text-sm leading-6 text-[#718078]">연결된 이전 주 응답이 없습니다.</p>}
        </SectionCard>

        <SectionCard title="관리자 조치 이력" description="데이터베이스 사건 이벤트와 사건 요약 시각을 기준으로 표시합니다.">
          {supportCase ? (
            <ol className="m-0 grid list-none gap-4 border-l-2 border-[#dce5e1] pl-5">
              <li className="relative">
                <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-[#176b52] ring-4 ring-white" />
                <p className="m-0 text-sm font-black">지원 사건 생성</p>
                <p className="mb-0 mt-1 text-xs text-[#718078]">{formatKoreanDateTime(supportCase.createdAt)}</p>
              </li>
              {supportCase.events?.length ? [...supportCase.events]
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((event) => (
                  <li className="relative" key={event.id}>
                    <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-[#176b52] ring-4 ring-white" />
                    <p className="m-0 text-sm font-black">{caseActionLabels[event.action] ?? event.action.replaceAll("_", " ")}</p>
                    <p className="mb-0 mt-1 text-xs text-[#718078]">
                      {formatKoreanDateTime(event.createdAt)}
                      {event.adminId ? ` · 관리자 ${shortId(event.adminId)}` : ""}
                    </p>
                  </li>
                )) : supportCase.acknowledgementAt ? (
                <li className="relative">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-[#176b52] ring-4 ring-white" />
                  <p className="m-0 text-sm font-black">운영팀 확인 완료</p>
                  <p className="mb-0 mt-1 text-xs text-[#718078]">{formatKoreanDateTime(supportCase.acknowledgementAt)}</p>
                </li>
              ) : null}
              <li className="relative">
                <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full bg-[#87938d] ring-4 ring-white" />
                <p className="m-0 text-sm font-black">현재 상태 · {caseStatusLabels[supportCase.status]}</p>
                <div className="mt-2"><CaseStatusBadge status={supportCase.status} /></div>
              </li>
            </ol>
          ) : (
            <div className="flex gap-3 text-sm leading-6 text-[#718078]">
              <Clock3 className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
              <p className="m-0">연결된 지원 사건이나 관리자 조치 기록이 없습니다.</p>
            </div>
          )}
          {supportCase?.internalNote ? (
            <div className="mt-5 rounded-xl border border-[#dce5e1] bg-[#f8faf9] p-3">
              <p className="m-0 text-xs font-extrabold text-[#718078]">최신 관리자 메모 · 사용자 비공개</p>
              <p className="mb-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-[#34443d]">{supportCase.internalNote}</p>
            </div>
          ) : null}
          {supportCase ? <p className="mb-0 mt-5 text-xs leading-5 text-[#87938d]">사건 ID {shortId(supportCase.id)} · 이벤트와 감사 원장은 데이터베이스에 별도로 보존됩니다.</p> : null}
        </SectionCard>
      </div>
    </div>
  );
}
