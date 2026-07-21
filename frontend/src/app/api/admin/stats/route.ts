import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins can see global stats
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    if (!dbUser || dbUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // ── Overview ──────────────────────────────────────────
    const [
      totalUsers,
      totalReports,
      reportsLast30d,
      reportsToday,
      reportsLast7d,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.reportRequest.count(),
      prisma.reportRequest.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.reportRequest.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.reportRequest.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    // ── Reports per day + unique active users per day (last 30 days) ───
    // Single query, derive both metrics in JS
    const recentReports = await prisma.reportRequest.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      select: { userId: true, createdAt: true },
    });

    const dailyMap: Record<string, number> = {};
    const usersPerDayMap: Record<string, Set<string>> = {};
    for (const r of recentReports) {
      const day = r.createdAt.toISOString().slice(0, 10);
      dailyMap[day] = (dailyMap[day] || 0) + 1;
      if (!usersPerDayMap[day]) usersPerDayMap[day] = new Set();
      usersPerDayMap[day].add(r.userId);
    }
    const dailyData = Object.entries(dailyMap)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const usersPerDay = Object.entries(usersPerDayMap)
      .map(([date, users]) => ({ date, count: users.size }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── Most requested registers ──────────────────────────
    const sourceCounts = await prisma.reportSource.groupBy({
      by: ["sourceType"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });
    const topRegisters = sourceCounts.map((s) => ({
      source: s.sourceType,
      count: s._count.id,
    }));

    // ── Success / failure rates ───────────────────────────
    const statusCounts = await prisma.reportRequest.groupBy({
      by: ["status"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    });
    const statusBreakdown = statusCounts.map((s) => ({
      status: s.status,
      count: s._count.id,
    }));

    // ── Source success/failure ────────────────────────────
    const sourceStatusCounts = await prisma.reportSource.groupBy({
      by: ["sourceType", "status"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    });
    const sourceBreakdown: Record<string, Record<string, number>> = {};
    for (const s of sourceStatusCounts) {
      if (!sourceBreakdown[s.sourceType]) sourceBreakdown[s.sourceType] = {};
      sourceBreakdown[s.sourceType][s.status] = s._count.id;
    }

    // ── Target type breakdown ─────────────────────────────
    const targetTypeCounts = await prisma.reportRequest.groupBy({
      by: ["targetType"],
      where: { createdAt: { gte: thirtyDaysAgo } },
      _count: { id: true },
    });
    const targetTypeBreakdown = targetTypeCounts.map((t) => ({
      targetType: t.targetType,
      count: t._count.id,
    }));

    // ── Hourly distribution (last 7 days) ─────────────────
    const last7dReports = await prisma.reportRequest.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true },
    });
    const hourlyMap: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourlyMap[h] = 0;
    for (const r of last7dReports) {
      hourlyMap[r.createdAt.getHours()]++;
    }
    const hourlyDistribution = Object.entries(hourlyMap).map(([hour, count]) => ({
      hour: parseInt(hour),
      count,
    }));

    return NextResponse.json({
      overview: {
        totalUsers,
        totalReports,
        reportsLast30d,
        reportsLast7d,
        reportsToday,
      },
      dailyData,
      usersPerDay,
      topRegisters,
      statusBreakdown,
      sourceBreakdown,
      targetTypeBreakdown,
      hourlyDistribution,
    });
  } catch (error) {
    console.error("GET /api/admin/stats error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
