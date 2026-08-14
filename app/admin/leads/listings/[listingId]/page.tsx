import Link from "next/link";
import { notFound } from "next/navigation";

import { ListingFunnelFieldsForm } from "@/components/admin/ListingFunnelFieldsForm";
import { AdminShell } from "@/components/admin/AdminShell";
import { SectionCard } from "@/components/admin/AdminPrimitives";
import { requireAdminPage } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type HomeRow = {
  id: string;
  name: string;
  transfer_registration_available: boolean | null;
  minimum_term_months: number | null;
  monthly_price_1: number | null;
  monthly_price_3: number | null;
  monthly_price_4: number | null;
  monthly_price_6: number | null;
  deposit_amount: number | null;
  management_fee_amount: number | null;
  kitchen_available: boolean | null;
  curfew: string | null;
  air_conditioner_available: boolean | null;
  bathroom_type: string | null;
  other_family_members_live: boolean | null;
  host_gender: string | null;
  host_introduction: string | null;
  pets: string | null;
  photo_urls: string[] | null;
  viewing_hours: string | null;
  immediate_viewing_available: boolean | null;
  facility_checked_at: string | null;
};

export default async function LeadListingDetailPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const { listingId } = await params;
  await requireAdminPage("LEAD_WRITE", `/admin/leads/listings/${listingId}`);
  const { data, error } = await createAdminClient()
    .from("homes")
    .select("*")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  const listing = data as HomeRow;
  return (
    <AdminShell
      active="leads"
      eyebrow="LISTING READINESS"
      title={listing.name}
      description="알 수 없는 사실을 임의로 채우지 마세요. 빈 값은 확인 필요로 표시됩니다."
      actions={
        <Link
          href="/admin/leads/listings"
          className="inline-flex min-h-11 items-center rounded-xl border border-[#bdcac4] bg-white px-4 text-sm font-bold text-[#405149] no-underline"
        >
          매물 목록으로
        </Link>
      }
    >
      <SectionCard title="운영·게스트 노출 매물 정보">
        <ListingFunnelFieldsForm
          listingId={listing.id}
          initial={{
            transferRegistrationAvailable:
              listing.transfer_registration_available,
            minimumTermMonths: listing.minimum_term_months,
            monthlyPrice1: listing.monthly_price_1,
            monthlyPrice3: listing.monthly_price_3,
            monthlyPrice4: listing.monthly_price_4,
            monthlyPrice6: listing.monthly_price_6,
            depositAmount: listing.deposit_amount,
            managementFeeAmount: listing.management_fee_amount,
            kitchenAvailable: listing.kitchen_available,
            curfew: listing.curfew,
            airConditionerAvailable: listing.air_conditioner_available,
            bathroomType: listing.bathroom_type,
            otherFamilyMembersLive: listing.other_family_members_live,
            hostGender: listing.host_gender,
            hostIntroduction: listing.host_introduction,
            pets: listing.pets,
            photoUrls: listing.photo_urls ?? [],
            viewingHours: listing.viewing_hours,
            immediateViewingAvailable: listing.immediate_viewing_available,
            facilityCheckedAt: listing.facility_checked_at,
          }}
        />
      </SectionCard>
    </AdminShell>
  );
}
