import type { ReactNode } from "react";
import { EyeOff, ShieldAlert } from "lucide-react";

import type { RiskLevel, SupportCaseStatus } from "@/lib/checkin/types";

import { caseStatusLabels, riskLabels } from "./admin-labels";

const riskStyles: Record<RiskLevel, string> = {
  GREEN: "border-emerald-200 bg-emerald-50 text-emerald-800",
  YELLOW: "border-amber-200 bg-amber-50 text-amber-900",
  ORANGE: "border-orange-200 bg-orange-50 text-orange-900",
  RED: "border-red-200 bg-red-50 text-red-800",
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-extrabold ${riskStyles[risk]}`}
    >
      {risk} · {riskLabels[risk]}
    </span>
  );
}

const caseStyles: Record<SupportCaseStatus, string> = {
  UNACKNOWLEDGED: "border-red-200 bg-red-50 text-red-800",
  OPEN: "border-blue-200 bg-blue-50 text-blue-800",
  CONTACTED: "border-cyan-200 bg-cyan-50 text-cyan-800",
  MEDIATING: "border-violet-200 bg-violet-50 text-violet-800",
  MONITORING: "border-amber-200 bg-amber-50 text-amber-900",
  RESOLVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSED: "border-slate-200 bg-slate-100 text-slate-700",
};

export function CaseStatusBadge({ status }: { status: SupportCaseStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-bold ${caseStyles[status]}`}
    >
      {caseStatusLabels[status]}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "default" | "critical" | "accent";
}) {
  const toneClass = {
    default: "border-[#dce5e1] bg-white",
    critical: "border-red-200 bg-red-50",
    accent: "border-[#b9d9cc] bg-[#eef8f3]",
  }[tone];

  return (
    <article className={`rounded-2xl border p-5 shadow-[0_8px_30px_rgba(30,65,52,0.04)] ${toneClass}`}>
      <p className="m-0 text-sm font-bold text-[#60706a]">{label}</p>
      <p className="mb-0 mt-2 text-3xl font-black tracking-[-0.04em]">{value}</p>
      {detail ? <p className="mb-0 mt-2 text-xs leading-5 text-[#718078]">{detail}</p> : null}
    </article>
  );
}

export function SectionCard({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#dce5e1] bg-white p-5 shadow-[0_10px_35px_rgba(30,65,52,0.05)] sm:p-6 ${className}`}>
      <div className="mb-5">
        <h2 className="m-0 text-xl font-black tracking-[-0.03em]">{title}</h2>
        {description ? <p className="mb-0 mt-2 text-sm leading-6 text-[#60706a]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs font-extrabold tracking-[0.04em] text-[#718078]">{item.label}</dt>
          <dd className="m-0 mt-1.5 text-sm font-semibold leading-6 text-[#27332e]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PrivacyWarning() {
  return (
    <aside className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <EyeOff className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
      <p className="m-0">
        <b className="block">운영팀 비교 전용 정보</b>
        상대방 응답은 지원 판단을 위해서만 함께 확인할 수 있습니다. 어느 쪽 사용자에게도 자동으로
        공개하거나 전달하지 말고, 반드시 응답자의 전달 동의를 먼저 확인하세요.
      </p>
    </aside>
  );
}

export function CriticalNotice({ children }: { children: ReactNode }) {
  return (
    <aside className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-950">
      <ShieldAlert className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
      <div>{children}</div>
    </aside>
  );
}
