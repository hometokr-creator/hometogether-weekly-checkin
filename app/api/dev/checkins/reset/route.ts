import "server-only";

import { resetMemoryRepositoryForDevelopment } from "@/lib/checkin/memory-repository";

export async function POST(request: Request) {
  if (
    process.env.NODE_ENV === "production" ||
    request.headers.get("x-hometogether-e2e-reset") !== "1"
  ) {
    return new Response(null, { status: 404 });
  }

  resetMemoryRepositoryForDevelopment();
  return Response.json({ ok: true });
}
