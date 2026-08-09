import { Activity, AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { AlimtalkTestForm } from "@/components/admin/AlimtalkTestForm";
import { MetricCard, SectionCard } from "@/components/admin/AdminPrimitives";
import { formatKoreanDateTime } from "@/components/admin/admin-labels";
import { requireAdminPage } from "@/lib/auth/admin";
import {
  getAdminSystemStatus,
  type OperationalState,
} from "@/lib/admin/system-status";

export const dynamic = "force-dynamic";

function StatusLabel({ state, label }: { state: OperationalState; label: string }) {
  const Icon =
    state === "OK"
      ? CheckCircle2
      : state === "ERROR"
        ? XCircle
        : state === "WARNING"
          ? AlertTriangle
          : CircleHelp;
  const tone =
    state === "OK"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : state === "ERROR"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${tone}`}>
      <Icon size={15} aria-hidden="true" /> {label}
    </span>
  );
}

function configured(value: boolean): OperationalState {
  return value ? "OK" : "WARNING";
}

function StatusRow({
  label,
  state,
  value,
  detail,
}: {
  label: string;
  state: OperationalState;
  value: string;
  detail?: string;
}) {
  return (
    <div className="grid gap-3 rounded-xl border border-[#e0e7e3] p-4 sm:grid-cols-[180px_auto_1fr] sm:items-center">
      <b>{label}</b>
      <StatusLabel state={state} label={value} />
      <span className="text-sm leading-6 text-[#60706a]">{detail}</span>
    </div>
  );
}

export default async function AdminSystemPage() {
  const admin = await requireAdminPage("CHECKIN_READ", "/admin/system");
  if (!admin.userId) return null;
  const status = await getAdminSystemStatus(admin.userId);
  const isSuperAdmin = admin.permissions.includes("SUPER_ADMIN");

  return (
    <AdminShell
      active="system"
      eyebrow="PRODUCTION READINESS"
      title="System Status"
      description={`민감한 값은 표시하지 않고 설정 여부와 운영 집계만 보여줍니다. 마지막 확인 ${formatKoreanDateTime(status.checkedAt)}`}
    >
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="전체 Profiles" value={status.profiles.total} detail={`활성 집주인 ${status.profiles.activeHosts} · 학생 ${status.profiles.activeGuests}`} />
        <MetricCard label="활성 Homes" value={status.homes.active} />
        <MetricCard label="활성 Matches" value={status.matches.active} />
        <MetricCard label="이번 주 응답률" value={`${status.weeklyCheckin.responseRate}%`} detail={`${status.weeklyCheckin.responses}/${status.weeklyCheckin.created}건`} tone="accent" />
      </section>

      <SectionCard
        title="Production 발송 대상 준비"
        description="현재 주차에 이미 초대가 생성된 이용자는 제외한 실시간 eligibility 집계입니다. 전화번호 원문은 표시하지 않습니다."
        className="mt-6"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="현재 발송 대상" value={status.weeklyCheckin.eligibleTargets} tone="accent" />
          <MetricCard label="전화번호 오류" value={status.weeklyCheckin.invalidPhone} tone={status.weeklyCheckin.invalidPhone ? "critical" : "default"} />
          <MetricCard label="알림 미동의" value={status.weeklyCheckin.notificationDisabled} />
          <MetricCard label="중복 활성 매칭" value={status.weeklyCheckin.multipleActiveMatches} tone={status.weeklyCheckin.multipleActiveMatches ? "critical" : "default"} />
        </div>
        <p className="mb-0 mt-4 text-sm font-semibold text-[#60706a]">
          대량 발송 게이트: {status.alimtalk.sendingEnabled ? "활성" : "비활성"} · 활성 Matches {status.matches.active}건
        </p>
      </SectionCard>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard title="핵심 연결" description="오류 원문이나 자격증명 값은 노출하지 않습니다.">
          <div className="grid gap-3">
            <StatusRow label="Database" state={status.database.state} value={status.database.connected ? "연결됨" : "오류"} detail={status.database.degraded ? "일부 집계를 불러오지 못했습니다." : "운영 집계 조회 정상"} />
            <StatusRow label="Cron 인증" state={configured(status.cron.secretConfigured)} value={status.cron.secretConfigured ? "Configured" : "Missing"} detail={status.cron.lastRunAt ? `최근 실행 ${formatKoreanDateTime(status.cron.lastRunAt)}` : "실행 기록 없음"} />
            <StatusRow label="Custom domain" state={configured(status.domain.baseUrlConfigured && status.domain.reachable)} value={status.domain.baseUrlConfigured && status.domain.reachable ? "Connected" : "Pending"} detail={`${status.domain.hostname} · base URL ${status.domain.baseUrlConfigured ? "설정" : "미설정"} · HTTPS ${status.domain.reachable ? "응답" : "미응답"}`} />
          </div>
        </SectionCard>

        <SectionCard title="Alimtalk" description={`선택 provider: ${status.alimtalk.provider}`}>
          <div className="grid gap-3">
            <StatusRow label="자격증명" state={configured(status.alimtalk.credentialsConfigured)} value={status.alimtalk.credentialsConfigured ? "Configured" : "Missing"} />
            <StatusRow label="발신 프로필" state={configured(status.alimtalk.senderProfileConfigured)} value={status.alimtalk.senderProfileConfigured ? "Configured" : "Missing"} />
            <StatusRow label="승인 템플릿" state={configured(status.alimtalk.templateConfigured)} value={status.alimtalk.templateConfigured ? "Configured" : "Missing"} />
            <StatusRow label="대량 발송 게이트" state={configured(status.alimtalk.sendingEnabled)} value={status.alimtalk.sendingEnabled ? "Enabled" : "Disabled"} detail="CHECKIN_SENDING_ENABLED는 기본적으로 비활성입니다." />
            <p className="m-0 text-sm text-[#60706a]">최근 집계: 성공 {status.alimtalk.recentSent}건 · 실패 {status.alimtalk.recentFailed}건</p>
            {isSuperAdmin ? (
              <div className="mt-2 border-t border-[#e0e7e3] pt-4">
                <h3 className="mb-2 mt-0 text-base font-black">관리자 테스트 1건</h3>
                <AlimtalkTestForm
                  enabled={status.alimtalk.readyForAdminTest}
                  disabledReason={
                    status.alimtalk.readyForAdminTest
                      ? undefined
                      : "Provider 자격증명, 발신 프로필과 승인 템플릿을 모두 설정해야 합니다."
                  }
                />
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Notification outbox" description="운영 발송 row만 집계하며 테스트 발송은 제외합니다.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Pending" value={status.outbox.pending} />
            <MetricCard label="Retry" value={status.outbox.retry} />
            <MetricCard label="Failed" value={status.outbox.failed} tone={status.outbox.failed ? "critical" : "default"} />
            <MetricCard label="오늘 Sent" value={status.outbox.sentToday} />
          </div>
          <p className="mb-0 mt-4 flex items-center gap-2 text-sm font-semibold text-[#60706a]"><Activity size={16} aria-hidden="true" /> 현재 처리 가능 {status.outbox.nextDue}건</p>
        </SectionCard>

        <SectionCard title="운영 관리" description="백업 상태는 Supabase 관리 화면에서 확인한 값을 환경변수로 명시합니다.">
          <div className="grid gap-3">
            <StatusRow label="등록 관리자" state={status.admin.activeCount > 0 ? "OK" : "WARNING"} value={`${status.admin.activeCount}명`} detail={`ADMIN_EMAILS ${status.admin.allowlistCount}개 · 형식 ${status.admin.allowlistValid ? "정상" : "오류"}`} />
            <StatusRow label="Automatic backup" state={status.backup.automatic === "ENABLED" ? "OK" : status.backup.automatic === "DISABLED" ? "WARNING" : "UNKNOWN"} value={status.backup.automatic} detail={`Supabase plan: ${status.backup.plan}`} />
            <StatusRow label="PITR" state={status.backup.pitr === "ENABLED" ? "OK" : status.backup.pitr === "DISABLED" ? "WARNING" : "UNKNOWN"} value={status.backup.pitr} />
            <StatusRow label="최근 Cron 성공" state={status.cron.lastSuccessAt ? "OK" : "UNKNOWN"} value={status.cron.lastSuccessAt ? formatKoreanDateTime(status.cron.lastSuccessAt) : "기록 없음"} detail={status.cron.lastErrorCode ? `최근 오류 코드: ${status.cron.lastErrorCode}` : "최근 오류 코드 없음"} />
            <StatusRow label="다음 처리 대상" state={status.cron.nextDueCount ? "WARNING" : "OK"} value={`${status.cron.nextDueCount}건`} detail="현재 시각 기준 pending/retry outbox" />
          </div>
        </SectionCard>
      </div>
    </AdminShell>
  );
}
