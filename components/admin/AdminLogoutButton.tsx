"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function AdminLogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-[#5d6d66] transition hover:bg-[#f3f6f4] hover:text-[#17211d] disabled:opacity-60"
      onClick={async () => {
        setPending(true);
        try {
          await createClient().auth.signOut();
        } catch {
          // A development bypass may not have a Supabase browser client. The
          // navigation still clears access to the current admin screen.
        } finally {
          router.replace("/admin/login");
          router.refresh();
        }
      }}
    >
      <LogOut size={17} aria-hidden="true" />
      {pending ? "로그아웃 중…" : "로그아웃"}
    </button>
  );
}
