"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  createClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/client";

type AdminLoginFormProps = {
  nextPath: string;
  initialError?: string;
  developmentBypassEnabled: boolean;
};

const initialErrorMessages: Record<string, string> = {
  forbidden: "이 계정에는 홈투게더 관리자 권한이 없습니다.",
  configuration:
    "관리자 인증 환경변수가 설정되지 않았습니다. 운영 담당자에게 문의해 주세요.",
};

export function AdminLoginForm({
  nextPath,
  initialError,
  developmentBypassEnabled,
}: AdminLoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(
    initialError ? initialErrorMessages[initialError] ?? "" : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const configured = isSupabaseBrowserConfigured();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setErrorMessage("이메일 또는 비밀번호를 확인해 주세요.");
        return;
      }

      const sessionResponse = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      if (!sessionResponse.ok) {
        await supabase.auth.signOut();
        const message =
          sessionResponse.status === 503
            ? "관리자 이메일 설정을 확인해 주세요."
            : "이 계정에는 홈투게더 관리자 권한이 없습니다.";
        setErrorMessage(message);
        return;
      }

      const session = (await sessionResponse.json()) as {
        mfa?: { currentLevel?: string | null; nextLevel?: string | null };
      };
      if (
        session.mfa?.nextLevel === "aal2" &&
        session.mfa.currentLevel !== "aal2"
      ) {
        router.replace(`/admin/mfa?next=${encodeURIComponent(nextPath)}`);
        router.refresh();
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setErrorMessage(
        "로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7f6] px-5 py-12 text-[#18231f]">
      <section
        className="w-full max-w-md rounded-3xl border border-[#dce4e0] bg-white p-7 shadow-[0_18px_50px_rgba(23,50,39,0.08)] sm:p-9"
        aria-labelledby="admin-login-title"
      >
        <div className="mb-8">
          <p className="mb-3 text-sm font-semibold tracking-[0.12em] text-[#39745d]">
            HOMETOGETHER
          </p>
          <h1
            id="admin-login-title"
            className="text-3xl font-bold tracking-[-0.03em]"
          >
            운영팀 로그인
          </h1>
          <p className="mt-3 text-base leading-7 text-[#5b6b64]">
            주간 체크인과 지원 사건은 승인된 운영팀 계정만 확인할 수
            있습니다.
          </p>
        </div>

        {developmentBypassEnabled ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            개발 관리자 우회가 활성화되어 있습니다. 이 모드는 production에서
            사용할 수 없습니다.
            <button
              type="button"
              className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-900 px-4 font-semibold text-white outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
              onClick={() => router.replace(nextPath)}
            >
              개발 관리자 화면 열기
            </button>
          </div>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="admin-email" className="mb-2 block font-semibold">
              이메일
            </label>
            <input
              id="admin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-[#b9c7c0] bg-white px-4 text-base outline-none transition focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
              placeholder="admin@hometogether.kr"
            />
          </div>

          <div>
            <label
              htmlFor="admin-password"
              className="mb-2 block font-semibold"
            >
              비밀번호
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-[#b9c7c0] bg-white px-4 text-base outline-none transition focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
            />
          </div>

          <div aria-live="polite" aria-atomic="true">
            {errorMessage ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !configured}
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#245c47] px-5 text-base font-bold text-white outline-none transition hover:bg-[#194c39] focus-visible:ring-4 focus-visible:ring-[#39745d]/30 disabled:cursor-not-allowed disabled:bg-[#9aaca4]"
          >
            {isSubmitting ? "확인 중…" : "로그인"}
          </button>

          {!configured ? (
            <p className="text-sm leading-6 text-[#6a766f]">
              로컬 실행을 위해 Supabase 공개 환경변수를 설정해 주세요.
            </p>
          ) : null}
        </form>

        <div className="mt-6 border-t border-[#e4eae7] pt-5 text-sm leading-6 text-[#6a766f]">
          최초 운영 환경을 설정하는 담당자인가요?{" "}
          <Link className="font-bold text-[#39745d] underline underline-offset-4" href="/admin/bootstrap">
            최초 관리자 등록 절차
          </Link>
        </div>
      </section>
    </main>
  );
}
