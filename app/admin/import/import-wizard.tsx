"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Download, LoaderCircle, Upload } from "lucide-react";

import { MetricCard, SectionCard } from "@/components/admin/AdminPrimitives";
import {
  createDefaultColumnMapping,
  importFieldLabels,
  importFieldNames,
  requiredImportFields,
  type ImportColumnMapping,
  type ImportIssue,
  type ImportPlanCounts,
  type ImportPreviewRow,
} from "@/lib/imports/contracts";
import { CsvParseError, parseCsv } from "@/lib/imports/csv";

type PreviewPlan = {
  fileSha256: string;
  planSha256: string;
  counts: ImportPlanCounts;
  issues: ImportIssue[];
  previewRows: ImportPreviewRow[];
  canApply: boolean;
};

type Step = "upload" | "mapping" | "preview" | "complete";

function apiMessage(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return fallback;
}

export function OperationalImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ImportColumnMapping>(() => createDefaultColumnMapping([]));
  const [plan, setPlan] = useState<PreviewPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [batchId, setBatchId] = useState("");

  const required = useMemo(() => new Set<string>(requiredImportFields), []);

  const reset = () => {
    setStep("upload");
    setFileName("");
    setCsv("");
    setHeaders([]);
    setMapping(createDefaultColumnMapping([]));
    setPlan(null);
    setConfirmed(false);
    setError("");
    setBatchId("");
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    if (file.size > 2_000_000) {
      setError("CSV 파일은 2MB 이하여야 합니다.");
      return;
    }
    try {
      const content = await file.text();
      const parsed = parseCsv(content);
      setFileName(file.name);
      setCsv(content);
      setHeaders(parsed.headers);
      setMapping(createDefaultColumnMapping(parsed.headers));
      setPlan(null);
      setStep("mapping");
    } catch (caught) {
      setError(caught instanceof CsvParseError ? caught.message : "CSV 파일을 읽지 못했습니다.");
    }
  };

  const requestPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/import/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName, csv, mapping }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "CSV 미리보기에 실패했습니다."));
      const nextPlan = (body as { plan?: PreviewPlan }).plan;
      if (!nextPlan) throw new Error("미리보기 결과 형식을 확인할 수 없습니다.");
      setPlan(nextPlan);
      setConfirmed(false);
      setStep("preview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSV 미리보기에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const applyImport = async () => {
    if (!plan || !confirmed || !plan.canApply) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/import/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName,
          csv,
          mapping,
          expectedPlanSha256: plan.planSha256,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiMessage(body, "운영 데이터 적용에 실패했습니다."));
      const id = (body as { batchId?: unknown }).batchId;
      if (typeof id !== "string") throw new Error("적용 결과를 확인할 수 없습니다.");
      setBatchId(id);
      setCsv("");
      setStep("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "운영 데이터 적용에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="CSV 가져오기"
      description={`1 업로드 → 2 컬럼 연결 → 3 오류·중복 미리보기 → 4 확인·저장 · 현재 단계: ${
        step === "upload" ? "1" : step === "mapping" ? "2" : step === "preview" ? "3" : "4"
      }`}
    >
      {error ? (
        <div role="alert" className="mb-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <AlertCircle className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
          <p className="m-0">{error}</p>
        </div>
      ) : null}

      {step === "upload" ? (
        <div className="grid gap-5">
          <label className="grid cursor-pointer place-items-center gap-3 rounded-2xl border-2 border-dashed border-[#b9d0c6] bg-[#f8fbf9] px-6 py-12 text-center hover:border-[#176b52]">
            <Upload size={28} className="text-[#176b52]" aria-hidden="true" />
            <span className="font-extrabold">운영 CSV 선택</span>
            <span className="text-xs text-[#65756e]">UTF-8 CSV · 최대 2MB · 최대 2,000행</span>
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
          </label>
          <a
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-[#b9d0c6] px-4 text-sm font-bold text-[#176b52] no-underline"
            href="/api/admin/import/template"
          >
            <Download size={17} aria-hidden="true" />
            헤더 전용 CSV 양식 받기
          </a>
        </div>
      ) : null}

      {step === "mapping" ? (
        <div className="grid gap-6">
          <div className="rounded-xl bg-[#f3f7f5] px-4 py-3 text-sm text-[#52635c]">
            <b>{fileName}</b> · CSV 헤더 {headers.length}개
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {importFieldNames.map((field) => (
              <label key={field} className="grid gap-1.5 text-sm font-bold text-[#34433d]">
                <span>
                  {importFieldLabels[field]}
                  {required.has(field) ? <em className="ml-1 not-italic text-red-600">필수</em> : null}
                </span>
                <select
                  className="min-h-11 rounded-xl border border-[#cad8d2] bg-white px-3 font-medium"
                  value={mapping[field]}
                  onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                >
                  <option value="">연결 안 함</option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="min-h-11 rounded-xl bg-[#176b52] px-5 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void requestPreview()}>
              {busy ? <LoaderCircle className="mr-2 inline animate-spin" size={17} /> : null}
              미리보기 실행
            </button>
            <button className="min-h-11 rounded-xl border border-[#cad8d2] px-5 font-bold" disabled={busy} onClick={reset}>취소</button>
          </div>
        </div>
      ) : null}

      {step === "preview" && plan ? (
        <div className="grid gap-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="CSV 행" value={plan.counts.sourceRows} />
            <MetricCard label="기존 hosts" value={plan.counts.existingHosts} />
            <MetricCard label="기존 guests" value={plan.counts.existingGuests} />
            <MetricCard label="기존 homes" value={plan.counts.existingHomes} />
            <MetricCard label="기존 active matches" value={plan.counts.existingActiveMatches} />
            <MetricCard label="생성 예정 profiles" value={plan.counts.createProfiles} />
            <MetricCard label="생성 예정 homes" value={plan.counts.createHomes} />
            <MetricCard label="생성 예정 matches" value={plan.counts.createMatches} />
            <MetricCard label="갱신 예정" value={plan.counts.updateProfiles + plan.counts.updateHomes + plan.counts.updateMatches} />
            <MetricCard label="중복 의심" value={plan.counts.duplicateSuspects} tone={plan.counts.duplicateSuspects ? "critical" : "default"} />
            <MetricCard label="필수값 누락" value={plan.counts.missingRequired} tone={plan.counts.missingRequired ? "critical" : "default"} />
            <MetricCard label="활성 사용자 전화 없음" value={plan.counts.activeUsersWithoutPhone} tone={plan.counts.activeUsersWithoutPhone ? "critical" : "default"} />
            <MetricCard label="전화 형식 오류" value={plan.counts.invalidPhone} tone={plan.counts.invalidPhone ? "critical" : "default"} />
            <MetricCard label="예상 주간 대상" value={plan.counts.expectedWeeklyTargets} tone="accent" />
          </div>

          {plan.issues.length > 0 ? (
            <div>
              <h3 className="mb-3 mt-0 text-base font-black">오류·주의 {plan.issues.length}건</h3>
              <div className="max-h-72 overflow-auto rounded-xl border border-[#e1e8e5]">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-[#f5f8f6]"><tr><th className="p-3">행</th><th className="p-3">코드</th><th className="p-3">내용</th></tr></thead>
                  <tbody>{plan.issues.map((issue, index) => (
                    <tr key={`${issue.rowNumber}-${issue.code}-${index}`} className="border-t border-[#e6ece9]">
                      <td className="p-3">{issue.rowNumber}</td><td className="p-3 font-mono text-xs">{issue.code}</td><td className="p-3">{issue.message}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 size={19} aria-hidden="true" /> 검증 오류가 없습니다.
            </div>
          )}

          <div className="overflow-auto rounded-xl border border-[#e1e8e5]">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-[#f5f8f6]"><tr><th className="p-3">행</th><th className="p-3">계약 ID</th><th className="p-3">상태</th><th className="p-3">주거지</th><th className="p-3">집주인</th><th className="p-3">학생</th></tr></thead>
              <tbody>{plan.previewRows.map((row) => (
                <tr key={row.rowNumber} className="border-t border-[#e6ece9]">
                  <td className="p-3">{row.rowNumber}</td><td className="p-3">{row.contractExternalId}</td><td className="p-3">{row.contractStatus}</td><td className="p-3">{row.homeName}</td><td className="p-3">{row.hostName}<small className="block text-[#718078]">{row.hostPhoneMasked ?? "전화 없음"}</small></td><td className="p-3">{row.guestName}<small className="block text-[#718078]">{row.guestPhoneMasked ?? "전화 없음"}</small></td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <p className="m-0 break-all rounded-xl bg-[#f3f7f5] p-3 font-mono text-xs text-[#60706a]">Plan SHA-256: {plan.planSha256}</p>
          <label className="flex gap-3 rounded-xl border border-[#cad8d2] p-4 text-sm font-semibold leading-6">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!plan.canApply} />
            실제 개인정보와 계약 관계를 검토했으며, 위 계획을 하나의 트랜잭션으로 적용하는 데 동의합니다.
          </label>
          <div className="flex flex-wrap gap-3">
            <button className="min-h-11 rounded-xl bg-[#176b52] px-5 font-bold text-white disabled:opacity-50" disabled={busy || !confirmed || !plan.canApply} onClick={() => void applyImport()}>
              {busy ? <LoaderCircle className="mr-2 inline animate-spin" size={17} /> : null}운영 DB에 적용
            </button>
            <button className="min-h-11 rounded-xl border border-[#cad8d2] px-5 font-bold" disabled={busy} onClick={() => setStep("mapping")}>컬럼 연결 수정</button>
            <button className="min-h-11 rounded-xl border border-[#cad8d2] px-5 font-bold" disabled={busy} onClick={reset}>새 파일</button>
          </div>
        </div>
      ) : null}

      {step === "complete" ? (
        <div className="grid gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
          <CheckCircle2 size={30} aria-hidden="true" />
          <h3 className="m-0 text-xl font-black">운영 데이터 적용 완료</h3>
          <p className="m-0 text-sm">가져오기 batch ID: <code>{batchId}</code></p>
          <p className="m-0 text-sm">CSV 원문은 브라우저 상태에서 제거했습니다. 실제 발송을 켜기 전에 System Status와 대상 미리보기를 다시 확인하세요.</p>
          <button className="min-h-11 w-fit rounded-xl border border-emerald-300 bg-white px-5 font-bold" onClick={reset}>다른 CSV 가져오기</button>
        </div>
      ) : null}
    </SectionCard>
  );
}
