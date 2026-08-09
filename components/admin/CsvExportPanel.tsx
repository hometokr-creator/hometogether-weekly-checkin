"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

const exports = [
  ["profiles", "전체 Profiles", "개인정보 포함 · 최고 관리자"],
  ["hosts", "Hosts", "집주인 Profiles"],
  ["guests", "Guests", "학생 Profiles"],
  ["homes", "Homes", "전체 주거지"],
  ["active-matches", "Active Matches", "현재 유효한 매칭"],
  ["matches", "전체 Matches", "종료·취소 포함"],
  ["weekly-checkins", "Weekly Check-ins", "주차별 초대·상태"],
  ["checkin-responses", "Check-in Responses", "안전 응답 포함"],
  ["issues", "불편사항 / 이슈", "카테고리·희망 조치"],
  ["notification-outbox", "Notification Outbox", "전화번호 원문 제외"],
] as const;

export function CsvExportPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [from, to]);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 rounded-2xl border border-[#dce5e1] bg-white p-5 sm:grid-cols-2 sm:p-6">
        <label className="text-sm font-bold">
          시작일
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#bdcac4] px-3" />
        </label>
        <label className="text-sm font-bold">
          종료일
          <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#bdcac4] px-3" />
        </label>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {exports.map(([dataset, title, detail]) => (
          <article key={dataset} className="flex flex-col rounded-2xl border border-[#dce5e1] bg-white p-5">
            <h2 className="m-0 text-lg font-black">{title}</h2>
            <p className="mb-5 mt-2 flex-1 text-sm leading-6 text-[#60706a]">{detail}</p>
            <a href={`/api/admin/exports/${dataset}${query ? `?${query}` : ""}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#176b52] px-4 text-sm font-bold text-white no-underline">
              <Download size={16} aria-hidden="true" /> CSV 다운로드
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}
