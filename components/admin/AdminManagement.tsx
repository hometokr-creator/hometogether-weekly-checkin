"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminMember } from "@/lib/auth/admin-members";

const permissions = [
  ["CHECKIN_READ", "체크인 조회"],
  ["SAFETY_READ", "안전 응답 조회"],
  ["CONTACT_READ", "원문 연락처 접근"],
  ["DATA_EXPORT", "민감 CSV 내보내기"],
  ["CASE_WRITE", "지원 사건 변경"],
  ["LEAD_READ", "리드 조회"],
  ["LEAD_WRITE", "리드·방문 변경"],
  ["LEAD_IMPORT", "과거 문의 가져오기"],
  ["LEAD_ANALYTICS", "리드 분석 조회"],
  ["SUPER_ADMIN", "최고 관리자"],
] as const;

type Permission = (typeof permissions)[number][0];

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    requestId?: string;
  };
  return `${payload.message ?? fallback}${payload.requestId ? ` (문의 코드: ${payload.requestId})` : ""}`;
}

function PermissionCheckboxes({
  selected,
  onChange,
}: {
  selected: readonly string[];
  onChange: (next: Permission[]) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {permissions.map(([value, label]) => (
        <label
          key={value}
          className="flex min-h-11 items-center gap-2 rounded-xl border border-[#d8e2dd] px-3 text-sm font-semibold"
        >
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={(event) => {
              const next = event.target.checked
                ? [...selected, value]
                : selected.filter((item) => item !== value);
              onChange([...new Set(next)] as Permission[]);
            }}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function AdminManagement({
  initialMembers,
  currentUserId,
}: {
  initialMembers: AdminMember[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [newPermissions, setNewPermissions] = useState<Permission[]>([
    "CHECKIN_READ",
    "SAFETY_READ",
    "CASE_WRITE",
  ]);
  const [message, setMessage] = useState<string>();
  const [pendingId, setPendingId] = useState<string>();

  async function addAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    setPendingId("new");
    try {
      const response = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, permissions: newPermissions }),
      });
      if (!response.ok)
        throw new Error(
          await responseMessage(response, "관리자를 추가하지 못했습니다."),
        );
      setEmail("");
      setMessage("관리자 권한을 추가했습니다.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "관리자를 추가하지 못했습니다.",
      );
    } finally {
      setPendingId(undefined);
    }
  }

  async function updateMember(
    member: AdminMember,
    next: { permissions: Permission[]; isActive: boolean; reason?: string },
  ) {
    setMessage(undefined);
    setPendingId(member.userId);
    try {
      const response = await fetch(
        `/api/admin/members/${encodeURIComponent(member.userId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        },
      );
      if (!response.ok)
        throw new Error(
          await responseMessage(response, "관리자 권한을 변경하지 못했습니다."),
        );
      setMessage(
        next.isActive
          ? "관리자 권한을 저장했습니다."
          : "관리자를 비활성화했습니다.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "관리자 권한을 변경하지 못했습니다.",
      );
    } finally {
      setPendingId(undefined);
    }
  }

  return (
    <div className="grid gap-6">
      <form
        onSubmit={addAdmin}
        className="grid gap-4 rounded-2xl border border-[#dce5e1] bg-white p-5 sm:p-6"
      >
        <div>
          <h2 className="m-0 text-xl font-black">
            기존 인증 계정에 관리자 권한 추가
          </h2>
          <p className="mb-0 mt-2 text-sm leading-6 text-[#60706a]">
            Supabase Auth에서 이메일 인증을 완료한 기존 계정만 추가합니다.
            계정이나 임시 비밀번호를 자동 생성하지 않습니다.
          </p>
        </div>
        <label className="text-sm font-bold">
          인증된 이메일
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-xl border border-[#b9c7c0] px-4 outline-none focus:border-[#39745d] focus:ring-4 focus:ring-[#39745d]/15"
          />
        </label>
        <PermissionCheckboxes
          selected={newPermissions}
          onChange={setNewPermissions}
        />
        <button
          type="submit"
          disabled={pendingId === "new" || newPermissions.length === 0}
          className="min-h-12 rounded-xl bg-[#176b52] px-5 font-bold text-white disabled:bg-[#9aaca4] sm:w-fit"
        >
          {pendingId === "new" ? "확인 중…" : "관리자 권한 추가"}
        </button>
      </form>

      {message ? (
        <p
          role="status"
          className="m-0 rounded-xl border border-[#cddbd4] bg-white p-4 text-sm font-semibold"
        >
          {message}
        </p>
      ) : null}

      <section className="grid gap-3" aria-label="등록 관리자">
        {initialMembers.map((member) => (
          <MemberEditor
            key={member.userId}
            member={member}
            isCurrent={member.userId === currentUserId}
            pending={pendingId === member.userId}
            onSave={(next) => updateMember(member, next)}
          />
        ))}
      </section>
    </div>
  );
}

function MemberEditor({
  member,
  isCurrent,
  pending,
  onSave,
}: {
  member: AdminMember;
  isCurrent: boolean;
  pending: boolean;
  onSave: (next: {
    permissions: Permission[];
    isActive: boolean;
    reason?: string;
  }) => void;
}) {
  const [selected, setSelected] = useState<Permission[]>(
    member.permissions as Permission[],
  );
  const [reason, setReason] = useState("");

  return (
    <article className="grid gap-4 rounded-2xl border border-[#dce5e1] bg-white p-5 lg:grid-cols-[minmax(220px,.8fr)_minmax(360px,1.4fr)_auto] lg:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <b>{member.email ?? "Auth 이메일 없음"}</b>
          {isCurrent ? (
            <span className="rounded-full bg-[#e7f3ed] px-2 py-1 text-xs font-bold text-[#0d523e]">
              현재 계정
            </span>
          ) : null}
          <span
            className={`rounded-full px-2 py-1 text-xs font-bold ${member.isActive ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}
          >
            {member.isActive ? "활성" : "비활성"}
          </span>
        </div>
        <p className="mb-0 mt-2 font-mono text-xs text-[#718078]">
          {member.userId}
        </p>
      </div>
      <div className="grid gap-3">
        <PermissionCheckboxes selected={selected} onChange={setSelected} />
        {!member.isActive ? (
          <p className="m-0 text-xs text-[#718078]">
            비활성 계정은 환경변수 허용 목록에 있어도 자동 재활성화되지
            않습니다.
          </p>
        ) : null}
      </div>
      <div className="grid min-w-48 gap-2">
        {member.isActive ? (
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="비활성화 사유"
            maxLength={500}
            className="min-h-11 rounded-xl border border-[#c6d2cc] px-3 text-sm"
          />
        ) : null}
        <button
          type="button"
          disabled={pending || selected.length === 0}
          onClick={() =>
            onSave({ permissions: selected, isActive: member.isActive })
          }
          className="min-h-11 rounded-xl border border-[#9bbcaf] bg-[#f4faf7] px-4 text-sm font-bold text-[#0d523e] disabled:opacity-50"
        >
          {pending ? "저장 중…" : "권한 저장"}
        </button>
        <button
          type="button"
          disabled={pending || (member.isActive && !reason.trim())}
          onClick={() =>
            onSave({
              permissions: selected,
              isActive: !member.isActive,
              reason: member.isActive ? reason.trim() : undefined,
            })
          }
          className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${member.isActive ? "border border-red-200 bg-red-50 text-red-800" : "bg-[#176b52] text-white"}`}
        >
          {member.isActive ? "비활성화" : "재활성화"}
        </button>
      </div>
    </article>
  );
}
