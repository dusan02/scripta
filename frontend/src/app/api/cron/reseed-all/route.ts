import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedFromRuz } from "@/lib/ruz";
import { seedFromOrsr } from "@/lib/orsr";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RESEED_BATCH_SIZE = 100;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("x-cron-secret");
  if (auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Process in batches to avoid loading 518K+ rows into memory at once.
  // Each batch is processed sequentially with rate limiting between companies.
  const excludeIcos = ["", "N/A", "neuvedene", "neuvedené", "Neznáme", "99999999", "00000000"];
  const results: { ico: string; ruz: boolean; orsr: boolean }[] = [];
  let cursor: string | null = null;
  let totalProcessed = 0;

  while (true) {
    const batch: { ico: string }[] = await prisma.company.findMany({
      where: {
        ico: {
          not: { in: excludeIcos },
          ...(cursor ? { gt: cursor } : {}),
        },
      },
      select: { ico: true },
      orderBy: { ico: "asc" },
      take: RESEED_BATCH_SIZE,
    });

    if (batch.length === 0) break;

    for (const c of batch) {
      let ruz = false;
      let orsr = false;
      try {
        const r = await seedFromRuz(c.ico);
        ruz = !!r;
      } catch (e) {
        console.error(`[reseed] RÚZ failed for ${c.ico}:`, e);
      }
      try {
        const o = await seedFromOrsr(c.ico);
        orsr = !!o;
      } catch (e) {
        console.error(`[reseed] ORSR failed for ${c.ico}:`, e);
      }
      results.push({ ico: c.ico, ruz, orsr });
      // Rate limit: 500ms between companies
      await new Promise((r) => setTimeout(r, 500));
    }

    totalProcessed += batch.length;
    cursor = batch[batch.length - 1].ico;
    console.log(`[reseed] Processed ${totalProcessed} companies (cursor: ${cursor})`);
  }

  return NextResponse.json({
    total: totalProcessed,
    results,
  });
}
