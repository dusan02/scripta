import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { alertListQuerySchema } from "@/lib/api-schemas";

export const dynamic = "force-dynamic";

// GET — list alert events for the user's watched companies (IDOR protected)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = alertListQuerySchema.safeParse({
    limit: searchParams.get("limit") || undefined,
    offset: searchParams.get("offset") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const { limit, offset } = parsed.data;

  // Get user's watched company IČOs
  const watched = await prisma.watchedCompany.findMany({
    where: { userId: user.id, deletedAt: null },
    select: { companyId: true },
  });
  const companyIds = watched.map((w) => w.companyId);

  if (companyIds.length === 0) {
    return NextResponse.json({ alerts: [], total: 0 });
  }

  const [alerts, total] = await Promise.all([
    prisma.alertEvent.findMany({
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.alertEvent.count({
      where: {
        companyId: { in: companyIds },
        deletedAt: null,
      },
    }),
  ]);

  // Include delivery status for the user
  const alertIds = alerts.map((a) => a.id);
  const deliveries = await prisma.alertDelivery.findMany({
    where: {
      alertId: { in: alertIds },
      userId: user.id,
      deletedAt: null,
    },
    select: { alertId: true, status: true, channel: true, sentAt: true },
  });

  const deliveryMap = new Map(deliveries.map((d) => [d.alertId, d]));

  const alertsWithDelivery = alerts.map((a) => ({
    ...a,
    delivery: deliveryMap.get(a.id) || null,
  }));

  return NextResponse.json({ alerts: alertsWithDelivery, total });
}
