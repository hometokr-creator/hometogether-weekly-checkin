import "server-only";

import type { CheckinRepository } from "@/lib/checkin/repository";
import { MemoryCheckinRepository } from "@/lib/checkin/memory-repository";

let repository: CheckinRepository | undefined;

export function hasSupabaseServerConfig(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export async function getCheckinRepository(): Promise<CheckinRepository> {
  if (repository) return repository;

  if (hasSupabaseServerConfig()) {
    const { SupabaseCheckinRepository } = await import("@/lib/checkin/supabase-repository");
    const supabaseRepository = new SupabaseCheckinRepository();
    repository = supabaseRepository;
    return supabaseRepository;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Supabase server configuration is required in production. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  const memoryRepository = new MemoryCheckinRepository();
  repository = memoryRepository;
  return memoryRepository;
}
