import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedFromRuz } from "@/lib/ruz";
import { seedFromOrsr } from "@/lib/orsr";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("x-cron-secret");
  if (auth !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companies = await prisma.company.findMany({
    where: {
      ico: { not: { in: ["", "N/A", "neuvedene", "neuvedené", "Neznáme", "99999999", "00000000"] } },
    },
    select: { ico: true },
  });

  const results: { ico: string; ruz: boolean; orsr: boolean }[] = [];

  for (const c of companies) {
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

  return NextResponse.json({
    total: companies.length,
    results,
  });
}
