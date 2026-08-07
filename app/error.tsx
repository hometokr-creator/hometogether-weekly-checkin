"use client";

import Link from "next/link";

export default function ApplicationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f4f7f5] px-5 py-12 text-[#17211d]">
      <section className="w-full max-w-lg rounded-3xl border border-[#dce5e1] bg-white p-7 text-center shadow-[0_18px_50px_rgba(23,50,39,0.08)] sm:p-9">
        <p className="mb-3 text-sm font-extrabold tracking-[0.1em] text-[#176b52]">HOMETOGETHER</p>
        <h1 className="m-0 text-2xl font-black tracking-[-0.03em]">페이지를 표시하지 못했습니다.</h1>
        <p className="mb-0 mt-4 leading-7 text-[#60706a]">
          입력한 답변이나 내부 오류 상세는 화면에 노출하지 않습니다. 잠시 후 다시 시도해 주세요.
        </p>
        {error.digest ? (
          <p className="mb-0 mt-3 rounded-xl bg-[#f3f6f4] p-3 font-mono text-xs text-[#53645d]">
            문의 코드: {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="min-h-11 rounded-xl bg-[#176b52] px-5 font-bold text-white">
            다시 시도
          </button>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] px-5 font-bold no-underline">
            서비스 홈
          </Link>
        </div>
      </section>
    </main>
  );
}
