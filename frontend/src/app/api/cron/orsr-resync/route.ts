import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { seedFromOrsr } from "@/lib/orsr";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST — ORSR re-sync for specific companies
// Body: { icos: ["12345678", ...] } (max 500)
// If no body, syncs top companies from WatchedCompany + recently visited
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitByKey("cron:orsr-resync", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  let icos: string[] = [];

  try {
    const body = await req.json();
    if (body?.icos && Array.isArray(body.icos)) {
      icos = body.icos.slice(0, 500);
    }
  } catch {
    // No body — get watched companies + top visited from DB
  }

  if (icos.length === 0) {
    // Get watched companies
    const watched = await prisma.watchedCompany.findMany({
      where: { deletedAt: null },
      select: { companyId: true },
      distinct: ["companyId"],
    });
    icos = watched.map((w) => w.companyId).filter(Boolean);
  }

  if (icos.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, message: "No ICOs to sync" });
  }

  const results: { ico: string; success: boolean; error?: string }[] = [];
  let synced = 0;
  let failed = 0;

  for (const ico of icos) {
    try {
      const result = await seedFromOrsr(ico);
      if (result) {
        synced++;
        results.push({ ico, success: true });
      } else {
        failed++;
        results.push({ ico, success: false, error: "Not found in ORSR" });
      }
    } catch (e) {
      failed++;
      results.push({
        ico,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Rate limit: 300ms between companies (avoid ORSR overload)
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`[ORSR re-sync] Synced: ${synced}, Failed: ${failed}, Total: ${icos.length}`);

  return NextResponse.json({
    ok: true,
    synced,
    failed,
    total: icos.length,
    results,
  });
}

// GET — for simple cron invocation (syncs watched companies only)
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitByKey("cron:orsr-resync", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 10,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  // Get watched companies
  const watched = await prisma.watchedCompany.findMany({
    where: { deletedAt: null },
    select: { companyId: true },
    distinct: ["companyId"],
  });

  const icos = watched.map((w) => w.companyId).filter(Boolean);
  if (icos.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, message: "No watched companies" });
  }

  let synced = 0;
  let failed = 0;

  for (const ico of icos) {
    try {
      const result = await seedFromOrsr(ico);
      if (result) synced++;
      else failed++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  return NextResponse.json({ ok: true, synced, failed, total: icos.length });
}
