"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";

import type { SupportCaseStatus } from "@/lib/checkin/types";

type CaseAction =
  | "ASSIGN"
  | "KAKAO_PLANNED"
  | "PHONE_COMPLETED"
  | "RULE_GUIDANCE"
  | "START_MEDIATION"
  | "CONTRACT_CONSULT"
  | "MONITOR"
  | "RESOLVE"
  | "CLOSE";

const caseActions: Array<{ action: CaseAction; label: string; tone?: "danger" | "primary" }> = [
  { action: "ASSIGN", label: "내 담당으로 지정", tone: "primary" },
  { action: "KAKAO_PLANNED", label: "카카오톡 연락 예정" },
  { action: "PHONE_COMPLETED", label: "전화 연락 완료" },
  { action: "RULE_GUIDANCE", label: "규칙 안내" },
  { action: "START_MEDIATION", label: "중재 시작" },
  { action: "CONTRACT_CONSULT", label: "계약 상담" },
  { action: "MONITOR", label: "모니터링" },
  { action: "RESOLVE", label: "해결 완료", tone: "primary" },
  { action: "CLOSE", label: "사건 종료", tone: "danger" },
];

type CaseActionsProps = {
  caseId: string;
  status: SupportCaseStatus;
};

export function CaseActions({ caseId, status }: CaseActionsProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [internalNote, setInternalNote] = useState("");
  const [resolutionCode, setResolutionCode] = useState("");

  async function runAction(action: "ACKNOWLEDGE" | CaseAction) {
    if (
      (action === "RESOLVE" || action === "CLOSE") &&
      !window.confirm(
        action === "CLOSE"
          ? "이 사건을 종료할까요? 입력한 메모와 해결 코드가 함께 기록됩니다."
          : "이 사건을 해결 완료로 표시할까요?",
      )
    ) {
      return;
    }

    setPendingAction(action);
    setMessage("");
    setHasError(false);

    try {
      const isAcknowledge = action === "ACKNOWLEDGE";
      const response = await fetch(
        isAcknowledge
          ? `/api/admin/support-cases/${encodeURIComponent(caseId)}/acknowledge`
          : "/api/admin/support-cases",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: isAcknowledge
            ? undefined
            : JSON.stringify({
                caseId,
                action,
                internalNote: internalNote.trim() || undefined,
                resolutionCode:
                  action === "RESOLVE" || action === "CLOSE"
                    ? resolutionCode.trim() || undefined
                    : undefined,
              }),
        },
      );

      const body = (await response.json().catch(() => null)) as
        | { error?: string; message?: string; requestId?: string }
        | null;

      if (!response.ok) {
        const supportCode = body?.requestId
          ? ` (문의 코드: ${body.requestId})`
          : "";
        throw new Error(
          `${body?.message || "조치를 저장하지 못했습니다."}${supportCode}`,
        );
      }

      setMessage("조치가 안전하게 기록되었습니다.");
      setHasError(false);
      setInternalNote("");
      setResolutionCode("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "조치를 저장하지 못했습니다.");
      setHasError(true);
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;

  return (
    <div className="space-y-5">
      {status === "UNACKNOWLEDGED" ? (
        <button
          type="button"
          onClick={() => runAction("ACKNOWLEDGE")}
          disabled={isPending}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-sm font-extrabold text-white outline-none transition hover:bg-red-800 focus-visible:ring-4 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
        >
          {pendingAction === "ACKNOWLEDGE" ? (
            <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
          ) : (
            <Check size={18} aria-hidden="true" />
          )}
          확인 완료로 기록
        </button>
      ) : null}

      <div className="grid gap-4 rounded-2xl border border-[#dce5e1] bg-[#f8faf9] p-4 sm:grid-cols-2">
        <label className="text-sm font-bold text-[#34443d] sm:col-span-2">
          관리자 메모 <span className="font-medium text-[#718078]">(선택, 최대 1,000자)</span>
          <textarea
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="사용자 화면에는 노출되지 않습니다. 필요한 사실만 기록하세요."
            className="mt-2 w-full resize-y rounded-xl border border-[#bdcac4] bg-white px-3 py-3 text-sm font-medium leading-6 outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15"
          />
        </label>
        <label className="text-sm font-bold text-[#34443d] sm:col-span-2">
          해결 코드 <span className="font-medium text-[#718078]">(해결·종료 시 선택, 최대 80자)</span>
          <input
            value={resolutionCode}
            onChange={(event) => setResolutionCode(event.target.value)}
            maxLength={80}
            placeholder="예: GUIDANCE_COMPLETED"
            className="mt-2 min-h-11 w-full rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-medium outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15"
          />
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {caseActions.map(({ action, label, tone }) => {
          const toneClass =
            tone === "danger"
              ? "border-red-200 text-red-800 hover:bg-red-50 focus-visible:ring-red-100"
              : tone === "primary"
                ? "border-[#8fc2ad] bg-[#eef8f3] text-[#0d523e] hover:bg-[#e0f2e9] focus-visible:ring-[#176b52]/15"
                : "border-[#cbd6d1] bg-white text-[#34443d] hover:bg-[#f3f6f4] focus-visible:ring-[#176b52]/15";

          return (
            <button
              key={action}
              type="button"
              onClick={() => runAction(action)}
              disabled={isPending}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold outline-none transition focus-visible:ring-4 disabled:cursor-wait disabled:opacity-50 ${toneClass}`}
            >
              {pendingAction === action ? (
                <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
              ) : null}
              {label}
            </button>
          );
        })}
      </div>

      <p
        className={`min-h-6 text-sm font-semibold ${hasError ? "text-red-700" : "text-[#176b52]"}`}
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  );
}
