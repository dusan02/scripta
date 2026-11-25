import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDbHealthChecker } from "@/lib/db-health";

export const dynamic = "force-dynamic";

const checkDbHealth = createDbHealthChecker(() => prisma.$queryRaw`SELECT 1`, {
  timeoutMs: 2500,
  okCacheTtlMs: 2000,
  errorCacheTtlMs: 1000,
});

export async function GET() {
  const result = await checkDbHealth();
  if (result.ok) {
    return NextResponse.json(
      { status: "ok", db: "ok" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(
    { status: "degraded", db: "error" },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}
