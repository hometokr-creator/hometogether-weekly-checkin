"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  leadChurnReasonLabels,
  leadChurnStageLabels,
} from "@/lib/leads/labels";
import type { LeadRecord } from "@/lib/leads/types";

type Listing = { id: string; name: string };

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    requestId?: string;
  };
  return `${body.message ?? fallback}${body.requestId ? ` (문의 코드: ${body.requestId})` : ""}`;
}

export function LeadActions({
  lead,
  listings,
}: {
  lead: LeadRecord;
  listings: Listing[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string>();
  const [message, setMessage] = useState("");
  const [selectedListing, setSelectedListing] = useState(
    lead.originalListingId ?? "",
  );
  const [churnStage, setChurnStage] = useState("INQUIRY");
  const [churnReason, setChurnReason] = useState("UNKNOWN");
  const [churnReasonNote, setChurnReasonNote] = useState("");

  async function run(body: Record<string, unknown>) {
    setPending(String(body.action));
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/leads/${encodeURIComponent(lead.id)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok)
        throw new Error(
          await errorMessage(response, "조치를 저장하지 못했습니다."),
        );
      setMessage("조치를 기록했습니다.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "조치를 저장하지 못했습니다.",
      );
    } finally {
      setPending(undefined);
    }
  }

  const latestViewing = lead.viewingEvents.find((event) => !event.cancelledAt);
  const disabled =
    Boolean(pending) || ["REGISTERED", "CHURNED"].includes(lead.status);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {!lead.firstResponseAt ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => run({ action: "RESPOND" })}
            className="min-h-11 rounded-xl bg-[#176b52] px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending === "RESPOND" ? "기록 중…" : "첫 응답 기록"}
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => run({ action: "REGISTER" })}
          className="min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-800 disabled:opacity-50"
        >
          등록 완료
        </button>
      </div>

      <label className="grid gap-2 text-sm font-bold text-[#34443d]">
        관심 또는 대체 매물
        <select
          value={selectedListing}
          onChange={(event) => setSelectedListing(event.target.value)}
          className="min-h-11 rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-semibold"
        >
          <option value="">매물 선택</option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !selectedListing}
          onClick={() =>
            run({ action: "REQUEST_VIEWING", listingId: selectedListing })
          }
          className="min-h-11 rounded-xl border border-[#9bbcaf] bg-[#eef8f3] px-4 text-sm font-bold text-[#0d523e] disabled:opacity-50"
        >
          방문 요청 기록
        </button>
        <button
          type="button"
          disabled={disabled || !selectedListing}
          onClick={() =>
            run({ action: "RECOMMEND_ALTERNATIVE", listingId: selectedListing })
          }
          className="min-h-11 rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] disabled:opacity-50"
        >
          대체 매물 제안
        </button>
      </div>
      {latestViewing ? (
        <div className="flex flex-wrap gap-2 rounded-xl bg-[#f4f7f5] p-3">
          {!latestViewing.confirmedAt ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run({
                  action: "CONFIRM_VIEWING",
                  viewingEventId: latestViewing.id,
                })
              }
              className="min-h-10 rounded-lg bg-[#176b52] px-3 text-sm font-bold text-white disabled:opacity-50"
            >
              방문 확정
            </button>
          ) : null}
          {latestViewing.confirmedAt && !latestViewing.viewingAt ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run({
                  action: "COMPLETE_VIEWING",
                  viewingEventId: latestViewing.id,
                })
              }
              className="min-h-10 rounded-lg bg-[#176b52] px-3 text-sm font-bold text-white disabled:opacity-50"
            >
              방문 완료
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              run({
                action: "CANCEL_VIEWING",
                viewingEventId: latestViewing.id,
                cancellationActor: "ADMIN",
              })
            }
            className="min-h-10 rounded-lg border border-red-200 bg-white px-3 text-sm font-bold text-red-800 disabled:opacity-50"
          >
            방문 취소
          </button>
        </div>
      ) : null}

      <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <b className="text-sm">이탈 사유 1클릭 기록</b>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={churnStage}
            onChange={(event) => setChurnStage(event.target.value)}
            className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 text-sm"
          >
            {Object.entries(leadChurnStageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={churnReason}
            onChange={(event) => setChurnReason(event.target.value)}
            className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 text-sm"
          >
            {Object.entries(leadChurnReasonLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <input
          value={churnReasonNote}
          onChange={(event) => setChurnReasonNote(event.target.value)}
          maxLength={2_000}
          placeholder="운영 메모 (선택)"
          className="min-h-11 rounded-xl border border-amber-200 bg-white px-3 text-sm"
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            run({
              action: "CHURN",
              churnStage,
              churnReason,
              churnReasonNote: churnReasonNote || undefined,
            })
          }
          className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-950 disabled:opacity-50 sm:w-fit"
        >
          이탈 기록
        </button>
      </div>
      <p
        role="status"
        className="m-0 min-h-5 text-sm font-semibold text-[#176b52]"
      >
        {message}
      </p>
    </div>
  );
}
