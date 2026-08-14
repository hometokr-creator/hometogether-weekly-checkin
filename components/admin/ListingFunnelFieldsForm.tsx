"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ListingFields = {
  transferRegistrationAvailable: boolean | null;
  minimumTermMonths: number | null;
  monthlyPrice1: number | null;
  monthlyPrice3: number | null;
  monthlyPrice4: number | null;
  monthlyPrice6: number | null;
  depositAmount: number | null;
  managementFeeAmount: number | null;
  kitchenAvailable: boolean | null;
  curfew: string | null;
  airConditionerAvailable: boolean | null;
  bathroomType: string | null;
  otherFamilyMembersLive: boolean | null;
  hostGender: string | null;
  hostIntroduction: string | null;
  pets: string | null;
  photoUrls: string[];
  viewingHours: string | null;
  immediateViewingAvailable: boolean | null;
  facilityCheckedAt: string | null;
};

const controlClass =
  "mt-1 min-h-11 w-full rounded-xl border border-[#bdcac4] bg-white px-3 text-sm outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15";

function boolValue(value: string) {
  return value === "unknown" ? null : value === "true";
}

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

export function ListingFunnelFieldsForm({
  listingId,
  initial,
}: {
  listingId: string;
  initial: ListingFields;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const update = <Key extends keyof ListingFields>(
    key: Key,
    value: ListingFields[Key],
  ) => setValues((current) => ({ ...current, [key]: value }));

  async function save() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/listings/${encodeURIComponent(listingId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!response.ok)
        throw new Error(body.message ?? "매물 조건을 저장하지 못했습니다.");
      setMessage(
        "매물 조건을 저장했습니다. 비어 있는 값은 게스트 화면에 ‘확인 필요’로 표시됩니다.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "매물 조건을 저장하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  const booleanField = (
    key:
      | "transferRegistrationAvailable"
      | "kitchenAvailable"
      | "airConditionerAvailable"
      | "otherFamilyMembersLive"
      | "immediateViewingAvailable",
    label: string,
  ) => (
    <label className="text-sm font-bold">
      {label}
      <select
        value={values[key] === null ? "unknown" : String(values[key])}
        onChange={(event) => update(key, boolValue(event.target.value))}
        className={controlClass}
      >
        <option value="unknown">확인 필요</option>
        <option value="true">가능·있음</option>
        <option value="false">불가·없음</option>
      </select>
    </label>
  );
  const numberField = (
    key:
      | "minimumTermMonths"
      | "monthlyPrice1"
      | "monthlyPrice3"
      | "monthlyPrice4"
      | "monthlyPrice6"
      | "depositAmount"
      | "managementFeeAmount",
    label: string,
  ) => (
    <label className="text-sm font-bold">
      {label}
      <input
        type="number"
        min="0"
        value={values[key] ?? ""}
        onChange={(event) => update(key, optionalNumber(event.target.value))}
        placeholder="확인 필요"
        className={controlClass}
      />
    </label>
  );
  const textField = (
    key: "curfew" | "bathroomType" | "pets" | "viewingHours",
    label: string,
  ) => (
    <label className="text-sm font-bold">
      {label}
      <input
        value={values[key] ?? ""}
        onChange={(event) => update(key, event.target.value || null)}
        placeholder="확인 필요"
        className={controlClass}
      />
    </label>
  );

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {booleanField("transferRegistrationAvailable", "전입신고 가능 여부")}
        {numberField("minimumTermMonths", "최소 계약기간(개월)")}
        {booleanField("immediateViewingAvailable", "즉시 방문 가능 여부")}
        {numberField("monthlyPrice1", "1개월 가격")}
        {numberField("monthlyPrice3", "3개월 가격")}
        {numberField("monthlyPrice4", "4개월 가격")}
        {numberField("monthlyPrice6", "6개월 가격")}
        {numberField("depositAmount", "보증금")}
        {numberField("managementFeeAmount", "관리비")}
        {booleanField("kitchenAvailable", "주방 사용")}
        {textField("curfew", "통금")}
        {booleanField("airConditionerAvailable", "에어컨")}
        {textField("bathroomType", "화장실 형태")}
        {booleanField("otherFamilyMembersLive", "다른 가족 거주")}
        {textField("pets", "반려동물")}
        {textField("viewingHours", "방문 가능한 시간")}
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">
          호스트 성별
          <select
            value={values.hostGender ?? ""}
            onChange={(event) =>
              update("hostGender", event.target.value || null)
            }
            className={controlClass}
          >
            <option value="">확인 필요</option>
            <option value="FEMALE">여성</option>
            <option value="MALE">남성</option>
            <option value="MIXED">혼성</option>
            <option value="OTHER">기타</option>
            <option value="UNSPECIFIED">미기재</option>
          </select>
        </label>
        <label className="text-sm font-bold">
          청결·시설 체크일
          <input
            type="date"
            value={values.facilityCheckedAt ?? ""}
            onChange={(event) =>
              update("facilityCheckedAt", event.target.value || null)
            }
            className={controlClass}
          />
        </label>
        <label className="text-sm font-bold sm:col-span-2">
          호스트 기본 소개
          <textarea
            value={values.hostIntroduction ?? ""}
            onChange={(event) =>
              update("hostIntroduction", event.target.value || null)
            }
            placeholder="확인 필요"
            maxLength={2_000}
            rows={4}
            className="mt-1 w-full rounded-xl border border-[#bdcac4] bg-white px-3 py-3 text-sm outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15"
          />
        </label>
        <label className="text-sm font-bold sm:col-span-2">
          사진 URL (한 줄에 하나씩)
          <textarea
            value={values.photoUrls.join("\n")}
            onChange={(event) =>
              update(
                "photoUrls",
                event.target.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              )
            }
            placeholder="확인 필요"
            maxLength={20_000}
            rows={4}
            className="mt-1 w-full rounded-xl border border-[#bdcac4] bg-white px-3 py-3 text-sm outline-none focus:border-[#176b52] focus:ring-4 focus:ring-[#176b52]/15"
          />
        </label>
      </section>
      <button
        type="button"
        disabled={pending}
        onClick={save}
        className="min-h-12 rounded-xl bg-[#176b52] px-5 text-sm font-bold text-white disabled:opacity-50 sm:w-fit"
      >
        {pending ? "저장 중…" : "매물 조건 저장"}
      </button>
      <p
        role="status"
        className="m-0 min-h-5 text-sm font-semibold text-[#176b52]"
      >
        {message}
      </p>
    </div>
  );
}
