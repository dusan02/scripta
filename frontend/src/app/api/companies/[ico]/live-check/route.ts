import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey } from "@/lib/rateLimit";
import {
  LIVE_CHECK_REGISTRIES,
  buildLiveCheckSummary,
} from "@/lib/liveRegistryCheck";

export const dynamic = "force-dynamic";

const WORKER_URL = process.env.WORKER_URL || "http://localhost:8000";
const WORKER_SECRET = process.env.WORKER_SECRET;

function getClientIp(req: NextRequest): string {
  // x-real-ip is set by nginx from $remote_addr (not client-controllable).
  // x-forwarded-for appends client-supplied values FIRST — the leftmost entry
  // is spoofable, so take the LAST one (the real client IP seen by nginx).
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const xff = req.headers.get("x-forwarded-for")?.split(",");
  return xff?.[xff.length - 1]?.trim() || "unknown";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ico: string } }
) {
  const ico = (params.ico || "").trim();
  if (!/^\d{8,10}$/.test(ico)) {
    return NextResponse.json({ error: "Invalid IČO" }, { status: 400 });
  }

  const events = await prisma.companyEvent.findMany({
    where: {
      companyIco: ico,
      eventType: "LIVE_REGISTRY_CHECK",
    },
    orderBy: { createdAt: "desc" },
  });

  const summary = buildLiveCheckSummary(ico, events);
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ico: string } }
) {
  const ico = (params.ico || "").trim();
  if (!/^\d{8,10}$/.test(ico)) {
    return NextResponse.json({ error: "Invalid IČO" }, { status: 400 });
  }

  // Check if company exists (city is sent to the worker — FS debtor list has no
  // IČO filter, name+city matching prevents false DEBT for name-alike firms)
  const company = await prisma.company.findUnique({
    where: { ico },
    select: { ico: true, name: true, city: true },
  });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Check existing state in DB first
  const existingEvents = await prisma.companyEvent.findMany({
    where: {
      companyIco: ico,
      eventType: "LIVE_REGISTRY_CHECK",
    },
    orderBy: { createdAt: "desc" },
  });

  const currentSummary = buildLiveCheckSummary(ico, existingEvents);
  const force = req.nextUrl.searchParams.get("force") === "1" && process.env.NODE_ENV !== "production";

  // If already running or fresh (<7 days), return current state without re-running Playwright
  if (!force && (currentSummary.isRunning || currentSummary.isFresh)) {
    return NextResponse.json(currentSummary);
  }

  // Denná kvóta pre drahé Playwright behy (limituje sa len SPUSTENIE nového
  // overenia — pozeranie cache-ovaných výsledkov je vždy zadarmo):
  //   anonym → 1 overenie / deň / IP
  //   prihlásený → 5 overení / deň / user
  const session = await getServerSession();
  const userId = session?.user?.id;
  const ip = getClientIp(req);
  // failClosed — drahý Playwright beh nesmie prejsť pri Redis výpadku
  // (memStore fallback by stratil Redis count → limit bypass).
  const rl = await rateLimitByKey(
    userId ? `live-check:user:${userId}` : `live-check:anon:${ip}`,
    {
      windowMs: 24 * 60 * 60 * 1000,
      maxRequests: userId ? 5 : 1,
      failClosed: true,
    }
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: userId
          ? "Vyčerpali ste dnešný limit 5 bezplatných overení. Skúste to znova zajtra."
          : "Bez registrácie môžete spustiť 1 bezplatné overenie denne.",
        code: "DAILY_LIMIT",
        registered: Boolean(userId),
        resetAt: rl.resetTime,
      },
      { status: 429 }
    );
  }

  const now = new Date();

  // Seed/reset all 7 registry rows into RUNNING state so polling immediately shows 7 spinners
  await prisma.$transaction(
    LIVE_CHECK_REGISTRIES.map((reg) =>
      prisma.companyEvent.deleteMany({
        where: {
          companyIco: ico,
          eventType: "LIVE_REGISTRY_CHECK",
          source: reg.source,
        },
      })
    )
  );

  await prisma.companyEvent.createMany({
    data: LIVE_CHECK_REGISTRIES.map((reg) => ({
      companyIco: ico,
      source: reg.source,
      eventType: "LIVE_REGISTRY_CHECK",
      severity: "LOW",
      title: reg.fullLabel,
      description: "Prebieha živé overenie v štátnom registri…",
      metadata: {
        state: "RUNNING",
        checkedAt: now.toISOString(),
      },
      createdAt: now,
    })),
  });

  // Trigger Python worker /live-check/{ico}
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_SECRET) {
    headers["x-worker-secret"] = WORKER_SECRET;
  }

  try {
    const workerRes = await fetch(`${WORKER_URL}/live-check/${ico}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ company_name: company.name, company_city: company.city }),
      signal: AbortSignal.timeout(8000),
    });
    if (!workerRes.ok) {
      const errText = await workerRes.text().catch(() => "");
      throw new Error(`Worker HTTP ${workerRes.status}: ${errText}`);
    }
  } catch (err: any) {
    // Mark rows as UNAVAILABLE so UI doesn't stay stuck in RUNNING if worker is offline
    await prisma.companyEvent.updateMany({
      where: {
        companyIco: ico,
        eventType: "LIVE_REGISTRY_CHECK",
      },
      data: {
        severity: "LOW",
        description: "Služba živého overovania je momentálne vyťažená alebo nedostupná.",
        metadata: {
          state: "UNAVAILABLE",
          checkedAt: new Date().toISOString(),
          error: err?.message || "Worker unreachable",
        },
      },
    });
    return NextResponse.json(
      { error: "Služba živého overovania je momentálne nedostupná. Skúste to prosím o chvíľu." },
      { status: 503 }
    );
  }

  const startedEvents = await prisma.companyEvent.findMany({
    where: {
      companyIco: ico,
      eventType: "LIVE_REGISTRY_CHECK",
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(buildLiveCheckSummary(ico, startedEvents));
}
