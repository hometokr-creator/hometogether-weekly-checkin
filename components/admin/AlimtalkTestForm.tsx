"use client";

import { useState } from "react";
import { LoaderCircle, Send } from "lucide-react";

export type AlimtalkTestFormProps = {
  enabled: boolean;
  disabledReason?: string;
};

export function AlimtalkTestForm({
  enabled,
  disabledReason,
}: AlimtalkTestFormProps) {
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || pending) return;
    if (!window.confirm("입력한 전화번호로 승인된 알림톡 템플릿 1건을 테스트 발송할까요?")) {
      return;
    }

    setPending(true);
    setMessage("");
    setHasError(false);
    try {
      const response = await fetch("/api/admin/system/alimtalk-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = (await response.json().catch(() => null)) as
        | { message?: string; requestId?: string }
        | null;
      if (!response.ok) {
        const supportCode = body?.requestId ? ` (문의 코드: ${body.requestId})` : "";
        throw new Error(`${body?.message ?? "테스트 발송을 등록하지 못했습니다."}${supportCode}`);
      }
      setMessage(body?.message ?? "테스트 발송 1건을 outbox에 등록했습니다.");
      setPhone("");
    } catch (error) {
      setHasError(true);
      setMessage(error instanceof Error ? error.message : "테스트 발송을 등록하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-bold text-[#34443d]">
        테스트 수신 전화번호
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="010-1234-5678"
          maxLength={24}
          disabled={!enabled || pending}
          required
          className="mt-2 min-h-11 w-full rounded-xl border border-[#bdcac4] bg-white px-3 text-sm font-medium outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15 disabled:bg-slate-100"
        />
      </label>
      <button
        type="submit"
        disabled={!enabled || pending || !phone.trim()}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#176b52] px-4 text-sm font-extrabold text-white outline-none transition hover:bg-[#105540] focus-visible:ring-4 focus-visible:ring-[#176b52]/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <LoaderCircle className="animate-spin" size={17} aria-hidden="true" />
        ) : (
          <Send size={17} aria-hidden="true" />
        )}
        알림톡 테스트 1건 등록
      </button>
      {!enabled && disabledReason ? (
        <p className="m-0 text-sm font-semibold text-amber-800">{disabledReason}</p>
      ) : null}
      <p
        className={`min-h-6 text-sm font-semibold ${hasError ? "text-red-700" : "text-[#176b52]"}`}
        aria-live="polite"
      >
        {message}
      </p>
    </form>
  );
}
