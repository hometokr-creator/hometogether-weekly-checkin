"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Preview = {
  totalRows: number;
  warnings: string[];
  records: Array<{
    recordId: string;
    customerLabel: string;
    source: string;
    confidence?: string;
  }>;
};

export function LeadCsvImport() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [sourceSystem, setSourceSystem] = useState("kakao_history");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function call(confirm: boolean) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/leads/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: fileName || "lead-import.csv",
          sourceSystem,
          csv,
          confirm,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        preview?: Preview;
        result?: {
          importedRows: number;
          skippedRows: number;
          alreadyApplied: boolean;
        };
      };
      if (!response.ok)
        throw new Error(body.message ?? "CSV를 처리하지 못했습니다.");
      if (!confirm && body.preview) setPreview(body.preview);
      if (confirm && body.result) {
        setMessage(
          body.result.alreadyApplied
            ? "같은 파일은 이미 적용되었습니다."
            : `${body.result.importedRows}건을 가져왔고 ${body.result.skippedRows}건은 기존 record_id를 갱신했습니다.`,
        );
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "CSV를 처리하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm leading-6 text-[#60706a]">
        과거 카카오 기록은 <code>record_id</code>가 있어야 합니다. 이름이나
        연락처로 중복을 추정하지 않으며, confidence는 HIGH·MEDIUM·LOW로
        남습니다.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setFileName(file.name);
          setCsv(await file.text());
          setPreview(undefined);
        }}
        className="block w-full text-sm"
      />
      <label className="text-sm font-bold">
        원본 시스템{" "}
        <input
          value={sourceSystem}
          onChange={(event) => setSourceSystem(event.target.value)}
          maxLength={80}
          className="ml-2 min-h-10 rounded-lg border border-[#bdcac4] px-3 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!csv || pending}
          onClick={() => call(false)}
          className="min-h-11 rounded-xl border border-[#9bbcaf] bg-white px-4 text-sm font-bold text-[#0d523e] disabled:opacity-50"
        >
          {pending ? "검토 중…" : "CSV 미리보기"}
        </button>
        {preview ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => call(true)}
            className="min-h-11 rounded-xl bg-[#176b52] px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            명시적으로 적용
          </button>
        ) : null}
      </div>
      {preview ? (
        <div className="rounded-xl bg-[#f4f7f5] p-3 text-sm">
          <b>{preview.totalRows}행</b>을 확인했습니다.{" "}
          {preview.warnings.length
            ? `${preview.warnings.length}개 경고`
            : "경고 없음"}
          .
          <ul className="mb-0 mt-2 list-disc pl-5">
            {preview.records.map((row) => (
              <li key={row.recordId}>
                {row.recordId} · {row.customerLabel} · {row.source} ·{" "}
                {row.confidence}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p
        role="status"
        className="m-0 min-h-5 text-sm font-semibold text-[#176b52]"
      >
        {message}
      </p>
    </div>
  );
}
