import type { Metadata } from "next";

import { CheckinFlow } from "@/components/checkin/CheckinFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "공동생활 주간 체크인 | 홈투게더",
  robots: { index: false, follow: false },
};

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CheckinFlow token={token} />;
}
