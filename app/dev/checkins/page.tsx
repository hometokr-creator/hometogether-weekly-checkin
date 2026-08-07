import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, FlaskConical } from "lucide-react";

import { getCheckinRepository } from "@/lib/checkin/repository-factory";

export const dynamic = "force-dynamic";

export default async function DevelopmentCheckinsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const links = await (await getCheckinRepository()).listDevelopmentLinks();

  return (
    <main className="dev-page">
      <section className="dev-shell">
        <div className="dev-heading">
          <span className="feature-icon"><FlaskConical size={20} /></span>
          <div>
            <p className="question-eyebrow">개발 환경 전용</p>
            <h1>체크인 시나리오</h1>
          </div>
        </div>
        <p className="dev-intro">
          각 링크는 개발용 Mock invitation입니다. 실제 발송 작업이 만든 링크도 서버 콘솔에서 확인할 수
          있으며, 이 화면은 production에서 노출되지 않습니다.
        </p>
        <div className="dev-link-list">
          {links.map((item) => (
            <Link key={item.urlToken} href={`/checkin/${item.urlToken}`} className="dev-link-card">
              <span>
                <b>{item.label}</b>
                <small>{item.role === "HOST" ? "집주인용 개인 링크" : "학생용 개인 링크"}</small>
              </span>
              <ArrowUpRight size={20} />
            </Link>
          ))}
        </div>
        <Link className="hero-action hero-action-secondary" href="/admin/checkins">관리자 대시보드 보기</Link>
      </section>
    </main>
  );
}
