import type { ReactNode } from "react";
import Link from "next/link";

import { ShieldCheck } from "lucide-react";

import { questionnaireNotices } from "@/lib/checkin/question-tree";

export function CheckinShell({
  children,
  progress,
  recipientName,
  period,
  onBack,
}: {
  children: ReactNode;
  progress: number;
  recipientName: string;
  period: string;
  onBack?: () => void;
}) {
  return (
    <main className="checkin-page">
      <div className="checkin-frame">
        <header className="checkin-header">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              홈
            </div>
            <div>
              <p className="brand-name">홈투게더</p>
              <p className="brand-subtitle">공동생활 주간 체크인</p>
            </div>
            <span className="period-pill">{period}</span>
          </div>
          <div className="progress-meta">
            {onBack ? (
              <button type="button" className="back-button" onClick={onBack} aria-label="이전 질문으로">
                이전
              </button>
            ) : (
              <span>{recipientName}님</span>
            )}
            <span>{Math.round(progress)}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            aria-label="체크인 진행률"
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="privacy-notice">
            <ShieldCheck size={19} aria-hidden="true" />
            <p>
              {questionnaireNotices.privacy}{" "}
              <Link href="/privacy/checkin" target="_blank" rel="noreferrer">
                개인정보 및 응답 처리 안내
              </Link>
            </p>
          </div>
        </header>

        <section className="question-area">{children}</section>

        <footer className="checkin-footer">
          {questionnaireNotices.nonPunitive}
          <span aria-hidden="true"> · </span>
          <Link href="/privacy/checkin" target="_blank" rel="noreferrer">
            수집·보관·삭제 안내
          </Link>
        </footer>
      </div>
    </main>
  );
}
