import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// PATCH — mark an alert delivery as read (IDOR protected)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 50 reads per minute
  const rl = await rateLimitByKey(`alert-read:${user.id}`, {
    windowMs: 60 * 1000,
    maxRequests: 50,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const alertId = params.id;

  // Verify the alert belongs to a company the user watches
  const alert = await prisma.alertEvent.findUnique({
    where: { id: alertId },
    select: { companyId: true, deletedAt: true },
  });

  if (!alert || alert.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const watched = await prisma.watchedCompany.findFirst({
    where: { userId: user.id, companyId: alert.companyId, deletedAt: null },
  });

  if (!watched) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Upsert alert delivery as READ
  const existing = await prisma.alertDelivery.findFirst({
    where: { alertId, userId: user.id, deletedAt: null },
  });

  if (existing) {
    const updated = await prisma.alertDelivery.update({
      where: { id: existing.id },
      data: { status: "READ" },
    });
    return NextResponse.json({ delivery: updated });
  }

  const delivery = await prisma.alertDelivery.create({
    data: {
      alertId,
      userId: user.id,
      channel: "IN_APP",
      status: "READ",
      sentAt: new Date(),
    },
  });

  return NextResponse.json({ delivery }, { status: 201 });
}
