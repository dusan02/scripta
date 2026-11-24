import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { seedFromOrsr } from "@/lib/orsr";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ORSR Mode B — Refresh stale companies (FIFO: oldest orsrSyncedAt first)
//
// GET  /api/cron/orsr-refresh?limit=500
//   Selects the N oldest synced eligible companies and re-scrapes ORSR.
//   Eligible = s.r.o., a.s., v.o.s., k.s. (same as bulk seed).
//   This is the weekly refresh cycle from orsr_continuous_sync_proposal.py.
//
// Throughput: ~500 companies in ~150s (300ms/company rate limit).
// Cron schedule: every 2 hours → 6000 companies/day → ~86 days for full cycle.

const ELIGIBLE_LEGAL_FORMS = [
  "s.r.o.",
  "a.s.",
  "v.o.s.",
  "k.s.",
  "Spoločnosť s ručením obmedzeným",
  "Akciová spoločnosť",
  "Jednoduchá spoločnosť na akcie",
  "Komanditná spoločnosť",
];

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimitByKey("cron:orsr-refresh", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 20,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 1000);

  // Select the N oldest synced eligible companies (FIFO refresh)
  const companies = await prisma.company.findMany({
    where: {
      orsrSyncedAt: { not: null },
      legalForm: { in: ELIGIBLE_LEGAL_FORMS },
    },
    orderBy: { orsrSyncedAt: "asc" },
    select: { ico: true, orsrSyncedAt: true },
    take: limit,
  });

  if (companies.length === 0) {
    return NextResponse.json({ ok: true, synced: 0, message: "No stale companies to refresh" });
  }

  const oldestSync = companies[0]?.orsrSyncedAt;
  const newestSync = companies[companies.length - 1]?.orsrSyncedAt;

  console.log(
    `[ORSR refresh] Refreshing ${companies.length} companies, ` +
    `oldest: ${oldestSync?.toISOString()}, newest: ${newestSync?.toISOString()}`
  );

  const results: { ico: string; success: boolean; error?: string; changed?: boolean }[] = [];
  let synced = 0;
  let failed = 0;
  let changed = 0;

  for (const company of companies) {
    try {
      // Capture old state for change detection
      const oldCompany = await prisma.company.findUnique({
        where: { ico: company.ico },
        select: {
          status: true,
          shareCapital: true,
          signingAuthority: true,
          businessActivity: true,
          legalStatus: true,
        },
      });

      const result = await seedFromOrsr(company.ico);

      if (result) {
        synced++;

        // Detect changes by comparing old vs new
        const isChanged =
          oldCompany?.status !== result.status ||
          oldCompany?.shareCapital !== result.shareCapital ||
          oldCompany?.signingAuthority !== result.signingAuthority ||
          oldCompany?.businessActivity !== result.businessActivity;

        if (isChanged) changed++;

        results.push({ ico: company.ico, success: true, changed: isChanged });
      } else {
        failed++;
        results.push({ ico: company.ico, success: false, error: "Not found in ORSR" });
      }
    } catch (e) {
      failed++;
      results.push({
        ico: company.ico,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // Rate limit: 300ms between companies (avoid ORSR overload)
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(
    `[ORSR refresh] Done: synced=${synced}, failed=${failed}, changed=${changed}, ` +
    `total=${companies.length}`
  );

  return NextResponse.json({
    ok: true,
    synced,
    failed,
    changed,
    total: companies.length,
    oldestSync: oldestSync?.toISOString(),
    newestSync: newestSync?.toISOString(),
    results: results.slice(0, 50), // Limit response size (full results in logs)
  });
}
