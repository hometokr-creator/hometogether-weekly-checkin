"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

type BootstrapResponse = {
  ok?: boolean;
  message?: string;
  requestId?: string;
};

export function AdminBootstrapForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [message, setMessage] = useState<string>();
  const [completed, setCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setSubmitting(true);

    try {
      const response = await fetch("/api/admin/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, bootstrapSecret }),
      });
      const payload = (await response.json()) as BootstrapResponse;
      if (!response.ok) {
        const supportCode = payload.requestId
          ? ` (문의 코드: ${payload.requestId})`
          : "";
        throw new Error(
          `${payload.message ?? "관리자 등록을 완료하지 못했습니다."}${supportCode}`,
        );
      }

      setCompleted(true);
      setPassword("");
      setBootstrapSecret("");
      setMessage(payload.message ?? "최초 관리자 등록을 완료했습니다.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "관리자 등록 중 오류가 발생했습니다.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f6] px-5 py-12 text-[#18231f]">
      <section className="w-full max-w-lg rounded-3xl border border-[#dce4e0] bg-white p-7 shadow-[0_18px_50px_rgba(23,50,39,0.08)] sm:p-9">
        <p className="mb-3 text-sm font-semibold tracking-[0.12em] text-[#39745d]">
          ONE-TIME ADMIN BOOTSTRAP
        </p>
        <h1 className="m-0 text-3xl font-bold tracking-[-0.03em]">최초 관리자 등록</h1>
        <p className="mt-3 text-base leading-7 text-[#5b6b64]">
          운영 환경의 <code>ADMIN_EMAIL</code>과 일치하는 계정 한 명만 등록합니다. 활성 관리자
          한 명이 생성되면 이 기능은 데이터베이스 상태를 확인해 자동으로 비활성화됩니다.
        </p>

        {completed ? (
          <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
            <p className="m-0 font-bold">{message}</p>
            <p className="mb-0 mt-2 text-sm leading-6">
              이제 Vercel에서 <code>ADMIN_BOOTSTRAP_SECRET</code>을 제거한 후 다시 배포하세요.
            </p>
            <Link
              href="/admin/login"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[#176b52] px-5 font-bold text-white no-underline"
            >
              관리자 로그인
            </Link>
          </div>
        ) : (
          <form className="mt-7 grid gap-5" onSubmit={submit} noValidate>
            <label className="font-semibold">
              관리자 이메일
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#b9c7c0] px-4 outline-none focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
              />
            </label>
            <label className="font-semibold">
              사용할 비밀번호
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#b9c7c0] px-4 outline-none focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
              />
              <small className="mt-1 block font-normal text-[#6a766f]">12자 이상으로 설정해 주세요.</small>
            </label>
            <label className="font-semibold">
              일회성 등록 암호
              <input
                type="password"
                autoComplete="off"
                required
                value={bootstrapSecret}
                onChange={(event) => setBootstrapSecret(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#b9c7c0] px-4 outline-none focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
              />
            </label>

            {message ? (
              <p role="alert" className="m-0 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
                {message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="min-h-12 rounded-xl bg-[#245c47] px-5 font-bold text-white disabled:bg-[#9aaca4]"
            >
              {submitting ? "안전하게 등록 중…" : "최초 관리자 등록"}
            </button>
          </form>
        )}

        {!completed ? (
          <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-bold text-[#39745d]" href="/admin/login">
            이미 계정이 있나요? 로그인
          </Link>
        ) : null}
      </section>
    </main>
  );
}
