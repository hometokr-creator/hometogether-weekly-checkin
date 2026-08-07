import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ShieldAlert } from "lucide-react";

import { questionnaireNotices } from "@/lib/checkin/question-tree";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CompletedPage({
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ safety?: string }>;
}) {
  const { safety } = await searchParams;
  const isSafety = safety === "1";
  return (
    <main className="completion-page">
      <section className="completion-card">
        <div className={`completion-icon ${isSafety ? "completion-icon-alert" : ""}`}>
          {isSafety ? <ShieldAlert size={34} /> : <CheckCircle2 size={34} />}
        </div>
        <p className="question-eyebrow">홈투게더 주간 체크인</p>
        <h1>응답이 안전하게 제출됐습니다.</h1>
        <p>
          답변은 홈투게더 운영팀이 먼저 확인합니다. 함께 거주하는 상대방에게 자동으로 전달되지
          않습니다.
        </p>
        {isSafety ? <div className="safety-completion">{questionnaireNotices.safetyCompletion}</div> : null}
        <div className="completion-divider" />
        <p className="completion-small">이 창은 닫으셔도 됩니다. 참여해 주셔서 감사합니다.</p>
        <Link className="mt-4 inline-flex min-h-11 items-center font-bold text-[#176b52] underline underline-offset-4" href="/privacy/checkin">
          개인정보 및 응답 처리 안내
        </Link>
      </section>
    </main>
  );
}
