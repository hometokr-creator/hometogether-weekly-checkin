"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ViewingSlotForm({
  listings,
}: {
  listings: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [listingId, setListingId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/leads/slots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          body.message ?? "방문 가능 시간을 저장하지 못했습니다.",
        );
      setMessage("방문 가능 시간을 저장했습니다.");
      setStartsAt("");
      setEndsAt("");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "방문 가능 시간을 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <select
        value={listingId}
        onChange={(event) => setListingId(event.target.value)}
        className="min-h-11 rounded-xl border border-[#bdcac4] bg-white px-3 text-sm"
      >
        <option value="">매물 선택</option>
        {listings.map((item) => (
          <option value={item.id} key={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <input
        aria-label="방문 시작 시간"
        type="datetime-local"
        value={startsAt}
        onChange={(event) => setStartsAt(event.target.value)}
        className="min-h-11 rounded-xl border border-[#bdcac4] px-3 text-sm"
      />
      <input
        aria-label="방문 종료 시간"
        type="datetime-local"
        value={endsAt}
        onChange={(event) => setEndsAt(event.target.value)}
        className="min-h-11 rounded-xl border border-[#bdcac4] px-3 text-sm"
      />
      <button
        type="button"
        disabled={!listingId || !startsAt || !endsAt || pending}
        onClick={submit}
        className="min-h-11 rounded-xl bg-[#176b52] px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-3 sm:w-fit"
      >
        {pending ? "저장 중…" : "운영자 대신 방문 슬롯 등록"}
      </button>
      <p
        role="status"
        className="m-0 min-h-5 text-sm font-semibold text-[#176b52] sm:col-span-3"
      >
        {message}
      </p>
    </div>
  );
}
