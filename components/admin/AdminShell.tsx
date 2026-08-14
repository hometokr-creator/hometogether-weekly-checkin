import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  ClipboardCheck,
  Database,
  HeartHandshake,
  Home,
  MessageCircleMore,
  ShieldCheck,
  Users,
} from "lucide-react";

import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

type AdminShellProps = {
  active: "checkins" | "cases" | "leads" | "system" | "admins" | "data";
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function AdminShell({
  active,
  eyebrow,
  title,
  description,
  actions,
  children,
}: AdminShellProps) {
  const navClass = (isActive: boolean) =>
    [
      "inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold no-underline transition",
      isActive
        ? "bg-[#e7f3ed] text-[#0d523e]"
        : "text-[#5d6d66] hover:bg-[#f3f6f4] hover:text-[#17211d]",
    ].join(" ");

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#17211d]">
      <header className="border-b border-[#dce5e1] bg-white/95">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            className="flex min-h-11 items-center gap-3 no-underline"
            href="/admin/checkins"
          >
            <span className="grid h-9 w-9 place-items-center rounded-xl rounded-bl-sm bg-[#176b52] text-xs font-black text-white">
              홈
            </span>
            <span>
              <b className="block text-base tracking-[-0.02em]">
                홈투게더 운영팀
              </b>
              <small className="block text-xs text-[#718078]">
                공동생활 주간 체크인
              </small>
            </span>
          </Link>

          <nav
            className="flex flex-wrap items-center gap-1"
            aria-label="관리자 메뉴"
          >
            <Link
              className={navClass(active === "checkins")}
              href="/admin/checkins"
            >
              <ClipboardCheck size={17} aria-hidden="true" />
              체크인 응답
            </Link>
            <Link
              className={navClass(active === "cases")}
              href="/admin/support-cases"
            >
              <HeartHandshake size={17} aria-hidden="true" />
              지원 사건
            </Link>
            <Link className={navClass(active === "leads")} href="/admin/leads">
              <MessageCircleMore size={17} aria-hidden="true" />
              문의 리드
            </Link>
            <Link className={navClass(active === "data")} href="/admin/data">
              <Database size={17} aria-hidden="true" />
              데이터
            </Link>
            <Link
              className={navClass(active === "system")}
              href="/admin/system"
            >
              <Activity size={17} aria-hidden="true" />
              시스템
            </Link>
            <Link
              className={navClass(active === "admins")}
              href="/admin/admins"
            >
              <Users size={17} aria-hidden="true" />
              관리자
            </Link>
            <Link className={navClass(false)} href="/admin/mfa">
              <ShieldCheck size={17} aria-hidden="true" />
              MFA
            </Link>
            <Link className={navClass(false)} href="/">
              <Home size={17} aria-hidden="true" />
              서비스 홈
            </Link>
            <AdminLogoutButton />
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="mb-2 text-sm font-extrabold tracking-[0.08em] text-[#176b52]">
              {eyebrow}
            </p>
            <h1 className="m-0 text-3xl font-black tracking-[-0.04em] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#60706a] sm:text-base">
              {description}
            </p>
          </div>
          {actions ? (
            <div className="flex flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>

        {children}
      </div>
    </main>
  );
}
