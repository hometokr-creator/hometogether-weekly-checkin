import type { Metadata } from "next";

import { AdminBootstrapForm } from "./bootstrap-form";

export const metadata: Metadata = {
  title: "최초 관리자 등록",
  robots: { index: false, follow: false },
};

export default function AdminBootstrapPage() {
  return <AdminBootstrapForm />;
}
