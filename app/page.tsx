import Link from "next/link";
import { ArrowRight, BellRing, LockKeyhole, ShieldCheck } from "lucide-react";

export default function Home() {
  const isProduction = process.env.NODE_ENV === "production";
  const primaryHref = isProduction ? "/privacy/checkin" : "/dev/checkins";
  const primaryLabel = isProduction ? "응답 처리 안내" : "개발 데모 열기";
  return (
    <main className="site-home">
      <div className="site-shell">
        <nav className="site-nav" aria-label="주요 메뉴">
          <Link className="site-brand" href="/">
            <span className="brand-dot">홈</span>
            홈투게더
          </Link>
          <Link className="nav-link" href="/admin/checkins">
            운영팀 화면
          </Link>
        </nav>

        <section className="hero">
          <div>
            <p className="hero-kicker">공동생활 주간 체크인</p>
            <h1>함께 사는 일상에, 작은 안부를 더합니다.</h1>
            <p className="hero-copy">
              매주 1분, 집주인과 학생이 각자 편하게 답합니다. 응답은 운영팀이 먼저 확인하고,
              도움이 필요한 순간에는 안전하게 지원으로 연결합니다.
            </p>
            <div className="hero-actions">
              <Link className="hero-action hero-action-primary" href={primaryHref}>
                {primaryLabel} <ArrowRight size={18} />
              </Link>
              <Link className="hero-action hero-action-secondary" href="/admin/checkins">
                관리자 대시보드
              </Link>
            </div>
          </div>

          <div className="hero-card" aria-label="주간 체크인 화면 미리보기">
            <div className="hero-card-top">
              <div>
                <p className="hero-card-label">이번 주를 돌아볼게요</p>
                <h2>공동생활은 전반적으로 어떠셨나요?</h2>
              </div>
              <ShieldCheck color="#176b52" size={25} />
            </div>
            <div className="hero-progress">
              <div className="hero-progress-meta">
                <span>주간 체크인</span>
                <span>62%</span>
              </div>
              <div className="hero-progress-track"><span /></div>
            </div>
            <div className="hero-option hero-option-selected"><span className="option-ring" />대체로 괜찮아요</div>
            <div className="hero-option"><span className="option-ring" />조금 불편한 점이 있어요</div>
            <div className="hero-option"><span className="option-ring" />지금 도움이 필요해요</div>
          </div>
        </section>

        <section className="feature-grid" aria-label="주요 특징">
          <article className="feature-card">
            <span className="feature-icon"><LockKeyhole size={21} /></span>
            <h3>서로에게 공개되지 않아요</h3>
            <p>집주인과 학생의 답변은 분리되며, 운영팀 검토 없이 상대방에게 전달되지 않습니다.</p>
          </article>
          <article className="feature-card">
            <span className="feature-icon"><BellRing size={21} /></span>
            <h3>매주 놓치지 않게</h3>
            <p>개인화된 안전 링크를 보내고, 완료한 사람을 제외해 필요한 경우 한 번만 알려드립니다.</p>
          </article>
          <article className="feature-card">
            <span className="feature-icon"><ShieldCheck size={21} /></span>
            <h3>위험 신호는 빠르게</h3>
            <p>서버에서 위험도를 계산하고 긴급 응답은 운영팀 확인 목록의 가장 위에 표시합니다.</p>
          </article>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#dce5e1] py-6 text-sm text-[#60706a]">
          <span>홈투게더 공동생활 주간 체크인</span>
          <Link className="font-bold underline underline-offset-4" href="/privacy/checkin">
            개인정보 및 응답 처리 안내
          </Link>
        </footer>
      </div>
    </main>
  );
}
