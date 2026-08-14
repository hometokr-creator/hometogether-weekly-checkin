import "server-only";

import { hasSupabaseServerConfig } from "@/lib/checkin/repository-factory";
import {
  MemoryLeadRepository,
  SupabaseLeadRepository,
  type LeadRepository,
} from "@/lib/leads/repository";

let repository: LeadRepository | undefined;

export async function getLeadRepository(): Promise<LeadRepository> {
  if (repository) return repository;
  if (hasSupabaseServerConfig()) {
    repository = new SupabaseLeadRepository();
    return repository;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Supabase server configuration is required for lead operations.",
    );
  }
  repository = new MemoryLeadRepository();
  return repository;
}
