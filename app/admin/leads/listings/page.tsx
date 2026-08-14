import Link from "next/link";

import { AdminShell } from "@/components/admin/AdminShell";
import { SectionCard } from "@/components/admin/AdminPrimitives";
import { requireAdminPage } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type HomeRow = {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  immediate_viewing_available: boolean | null;
  facility_checked_at: string | null;
};

export default async function LeadListingsPage() {
  await requireAdminPage("LEAD_WRITE", "/admin/leads/listings");
  const { data, error } = await createAdminClient()
    .from("homes")
    .select(
      "id,name,city,district,immediate_viewing_available,facility_checked_at",
    )
    .order("name");
  if (error) throw error;
  const listings = (data ?? []) as HomeRow[];
  return (
    <AdminShell
      active="leads"
      eyebrow="LISTING READINESS"
      title="매물 조건 표준화"
      description="값이 비어 있으면 게스트와 운영자 화면에서 ‘확인 필요’로 보입니다. 사진 URL도 같은 기준으로 관리합니다."
      actions={
        <Link
          href="/admin/leads"
          className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline"
        >
          리드 목록으로
        </Link>
      }
    >
      <SectionCard
        title="매물 목록"
        description="전입신고, 계약기간·가격, 생활 조건, 방문 가능 여부, 시설 체크일을 매물마다 입력합니다."
      >
        {listings.length ? (
          <div className="grid gap-3">
            {listings.map((listing) => (
              <Link
                key={listing.id}
                href={`/admin/leads/listings/${listing.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-[#dce5e1] px-4 py-4 text-sm no-underline hover:bg-[#f4f7f5]"
              >
                <span>
                  <b className="block text-[#17211d]">{listing.name}</b>
                  <small className="mt-1 block text-[#60706a]">
                    {[listing.city, listing.district]
                      .filter(Boolean)
                      .join(" ") || "지역 확인 필요"}
                  </small>
                </span>
                <span className="text-right text-[#0d523e]">
                  {listing.immediate_viewing_available === null
                    ? "방문 확인 필요"
                    : listing.immediate_viewing_available
                      ? "즉시 방문 가능"
                      : "즉시 방문 불가"}
                  <small className="mt-1 block text-[#60706a]">
                    시설 체크 {listing.facility_checked_at ?? "확인 필요"}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-xl bg-[#f4f7f5] p-5 text-sm font-semibold text-[#60706a]">
            등록된 매물이 없습니다.
          </p>
        )}
      </SectionCard>
    </AdminShell>
  );
}
