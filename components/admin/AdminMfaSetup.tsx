"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  status: string;
  factor_type: string;
  friendly_name?: string;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
};

export function AdminMfaSetup({
  nextPath,
  enforcementEnabled,
}: {
  nextPath: string;
  enforcementEnabled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [factor, setFactor] = useState<Factor>();
  const [unfinishedFactorId, setUnfinishedFactorId] = useState<string>();
  const [enrollment, setEnrollment] = useState<Enrollment>();
  const [currentLevel, setCurrentLevel] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string>();

  async function loadMfaState() {
    const supabase = createClient();
    const [factors, assurance] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (factors.error || assurance.error) {
      throw factors.error ?? assurance.error;
    }
    const verified = factors.data.totp[0] as Factor | undefined;
    const unfinished = (factors.data.all as Factor[]).find(
      (candidate) =>
        candidate.factor_type === "totp" && candidate.status !== "verified",
    );
    return {
      verified,
      unfinishedFactorId: unfinished?.id,
      currentLevel: assurance.data.currentLevel,
    };
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const state = await loadMfaState();
        if (!active) return;
        setFactor(state.verified);
        setUnfinishedFactorId(state.unfinishedFactorId);
        setCurrentLevel(state.currentLevel);
      } catch {
        if (active) setMessage("MFA 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function startEnrollment() {
    setPending(true);
    setMessage(undefined);
    try {
      const supabase = createClient();
      if (unfinishedFactorId) {
        const removed = await supabase.auth.mfa.unenroll({
          factorId: unfinishedFactorId,
        });
        if (removed.error) throw removed.error;
      }
      const enrolled = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "HomeTogether 관리자",
        issuer: "HomeTogether",
      });
      if (enrolled.error) throw enrolled.error;
      setEnrollment({
        factorId: enrolled.data.id,
        qrCode: enrolled.data.totp.qr_code,
      });
      setUnfinishedFactorId(enrolled.data.id);
      setMessage("인증 앱으로 QR 코드를 스캔한 뒤 6자리 코드를 입력하세요.");
    } catch {
      setMessage("MFA 등록을 시작하지 못했습니다. 기존 미완료 등록을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    try {
      const factorId = enrollment?.factorId ?? factor?.id;
      if (!factorId || !/^\d{6}$/.test(code)) {
        setMessage("인증 앱의 6자리 코드를 입력해 주세요.");
        return;
      }
      const result = await createClient().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (result.error) throw result.error;
      setEnrollment(undefined);
      setCode("");
      const state = await loadMfaState();
      setFactor(state.verified);
      setUnfinishedFactorId(state.unfinishedFactorId);
      setCurrentLevel(state.currentLevel);
      setMessage("MFA 인증이 완료되었습니다.");
      router.replace(nextPath);
      router.refresh();
    } catch {
      setMessage("코드가 올바르지 않거나 만료되었습니다. 새 코드를 입력해 주세요.");
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return <p className="m-0 text-sm text-[#60706a]">MFA 상태 확인 중…</p>;
  }

  const verifiedAtAal2 = Boolean(factor && currentLevel === "aal2");
  return (
    <div className="grid gap-5">
      <aside className={`rounded-2xl border p-4 text-sm leading-6 ${verifiedAtAal2 ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <b className="block">
          {verifiedAtAal2
            ? "현재 세션은 AAL2로 인증되었습니다."
            : factor
              ? "등록된 인증 앱으로 추가 인증이 필요합니다."
              : "아직 인증 앱이 등록되지 않았습니다."}
        </b>
        <span>
          전역 강제 상태: {enforcementEnabled ? "활성" : "등록 전 잠금 방지를 위해 비활성"}
        </span>
      </aside>

      {!factor && !enrollment ? (
        <button
          type="button"
          onClick={startEnrollment}
          disabled={pending}
          className="min-h-12 rounded-xl bg-[#176b52] px-5 font-bold text-white disabled:bg-[#9aaca4] sm:w-fit"
        >
          {pending ? "준비 중…" : unfinishedFactorId ? "미완료 등록 다시 시작" : "인증 앱 등록 시작"}
        </button>
      ) : null}

      {enrollment ? (
        <div className="grid gap-4 rounded-2xl border border-[#dce5e1] bg-white p-5 sm:p-6">
          <p className="m-0 text-sm leading-6 text-[#52635c]">
            QR 코드는 현재 로그인한 관리자 계정에서만 생성됩니다. 화면 캡처나 공유를 하지 마세요.
          </p>
          {/* Supabase returns a data:image/svg+xml URL; no remote image is loaded. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="HomeTogether 관리자 TOTP 등록 QR 코드"
            className="h-56 w-56 rounded-xl border border-[#dce5e1] bg-white p-3"
          />
        </div>
      ) : null}

      {(factor || enrollment) && !verifiedAtAal2 ? (
        <form onSubmit={verify} className="grid max-w-md gap-3">
          <label className="text-sm font-bold">
            인증 앱 코드
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              className="mt-2 min-h-12 w-full rounded-xl border border-[#b9c7c0] px-4 font-mono text-lg tracking-[0.2em]"
            />
          </label>
          <button
            type="submit"
            disabled={pending || code.length !== 6}
            className="min-h-12 rounded-xl bg-[#176b52] px-5 font-bold text-white disabled:bg-[#9aaca4]"
          >
            {pending ? "확인 중…" : enrollment ? "등록 및 인증 완료" : "추가 인증"}
          </button>
        </form>
      ) : null}

      {message ? <p role="status" className="m-0 rounded-xl border border-[#dce5e1] bg-white p-4 text-sm font-semibold">{message}</p> : null}
    </div>
  );
}
