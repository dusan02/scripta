import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// POST — daily monitoring check
// Checks all watched companies for recent changes in ORSR and creates AlertEvents.
// Scheduled to run daily at 06:00 UTC via Vercel Cron.
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: max 3 calls per hour (prevents abuse if secret leaks)
  const rl = await rateLimitByKey("cron:monitoring-check", {
    windowMs: 60 * 60 * 1000,
    maxRequests: 3,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  return runMonitoringCheck();
}

// Vercel Cron sends GET requests by default — delegate to POST handler.
export async function GET(req: NextRequest) {
  return POST(req);
}

async function runMonitoringCheck(): Promise<NextResponse> {
  try {
    // Get all unique watched company IČOs (across all users)
    const watched = await prisma.watchedCompany.findMany({
      where: { deletedAt: null },
      select: { companyId: true, userId: true },
      distinct: ["companyId"],
    });

    if (watched.length === 0) {
      return NextResponse.json({ ok: true, checked: 0, alerts: 0 });
    }

    let alertsCreated = 0;

    for (const w of watched) {
      try {
        // Check for recent CompanyEvent entries (last 24h) for this IČO
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const recentEvents = await prisma.companyEvent.findMany({
          where: {
            companyIco: w.companyId,
            eventDate: { gte: yesterday },
          },
          take: 10,
          orderBy: { eventDate: "desc" },
        });

        for (const event of recentEvents) {
          // Check if we already have an AlertEvent for this CompanyEvent
          const existing = await prisma.alertEvent.findFirst({
            where: {
              companyId: w.companyId,
              source: event.source,
              eventType: event.eventType,
              createdAt: { gte: yesterday },
              deletedAt: null,
            },
          });

          if (existing) continue;

          // Create AlertEvent
          const severity = determineSeverity(event.eventType);
          const alert = await prisma.alertEvent.create({
            data: {
              companyId: w.companyId,
              source: event.source,
              eventType: event.eventType,
              severity,
              title: `${event.source}: ${event.eventType}`,
              description: event.description || `${event.eventType} detected`,
              metadata: { companyEventId: event.id, amount: event.amount },
              riskScore: severity === "HIGH" ? 80 : severity === "MEDIUM" ? 50 : 20,
            },
          });

          // Create AlertDelivery for all users watching this company
          const watchers = await prisma.watchedCompany.findMany({
            where: { companyId: w.companyId, deletedAt: null },
            select: { userId: true },
          });

          for (const watcher of watchers) {
            await prisma.alertDelivery.create({
              data: {
                alertId: alert.id,
                userId: watcher.userId,
                channel: "IN_APP",
                status: "PENDING",
              },
            });
          }

          alertsCreated++;
        }
      } catch (err) {
        console.error(`[monitoring-check] Error for company ${w.companyId}:`, err);
      }
    }

    // Mark all checked alerts as notified
    await prisma.alertEvent.updateMany({
      where: { notifiedAt: null, deletedAt: null },
      data: { notifiedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      checked: watched.length,
      alerts: alertsCreated,
    });
  } catch (error) {
    console.error("POST /api/cron/monitoring-check error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function determineSeverity(eventType: string): "LOW" | "MEDIUM" | "HIGH" {
  const highSeverityTypes = [
    "EXEKUCIA", "KONKURS", "RESTRUKTURALIZACIA", "LIKVIDACIA",
    "ZABEZPECENIE", "DRZBA",
  ];
  const mediumSeverityTypes = [
    "ZMENA_PREDMETU", "ZMENA_SIDLOM", "ZMENA_STATUTAR",
    "ZMENA_SPOLUVLASTNICTVA",
  ];

  const upper = eventType.toUpperCase();
  if (highSeverityTypes.some((t) => upper.includes(t))) return "HIGH";
  if (mediumSeverityTypes.some((t) => upper.includes(t))) return "MEDIUM";
  return "LOW";
}
