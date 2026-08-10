import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import SearchSection from "@/components/SearchSection";
import ReportsTable from "@/components/ReportsTable";
import AddonCredits from "@/components/AddonCredits";
import NewUserBanner from "@/components/NewUserBanner";
import WatchedCompanies from "@/components/WatchedCompanies";

import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Verifa — Dashboard",
  description: "Verifa.sk — previerka subjektov zo štátnych registrov SR",
  robots: { index: false, follow: false },
};

async function getRecentReports(userId: string) {
  try {
    const reports = await prisma.reportRequest.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        sources: { select: { sourceType: true, status: true } },
      },
    });

    // Resolve companyName from Company table for reports where it's null
    const icosNeedingName = reports
      .filter((r) => !r.companyName && r.ico)
      .map((r) => r.ico as string);
    const companyNames: Record<string, string> = {};
    if (icosNeedingName.length > 0) {
      const companies = await prisma.company.findMany({
        where: { ico: { in: icosNeedingName } },
        select: { ico: true, name: true },
      });
      for (const c of companies) {
        if (c.name) companyNames[c.ico] = c.name;
      }
    }

    return reports.map((r) => ({
      ...r,
      companyName: r.companyName || (r.ico ? companyNames[r.ico] || null : null),
    }));
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  // Check trial/credits status — redirect to pricing if expired or no credits
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { trialEndsAt: true, planName: true },
  });

  let userBalance = 0;
  let userPlanName: string | null = null;

  if (user) {
    const now = new Date();
    const hasPlan = !!user.planName;
    userPlanName = user.planName;

    // Use CreditBatch SUM (non-expired) instead of Wallet.balance for consistency
    // with the report API. Wallet.balance can be stale if the expiration cron
    // hasn't run yet, leading to a discrepancy where dashboard shows credits
    // but report creation is blocked.
    const validBatches = await prisma.creditBatch.aggregate({
      where: {
        userId: session.user.id,
        remaining: { gt: 0 },
        expiresAt: { gt: now },
      },
      _sum: { remaining: true },
    });
    userBalance = validBatches._sum.remaining ?? 0;
    const hasCredits = userBalance > 0;

    // Only redirect to pricing if user has NO plan AND no credits
    if (!hasPlan && !hasCredits) {
      redirect("/pricing");
    }
  }

  const reports = await getRecentReports(session.user.id);
  const isNewUser = reports.length === 0;

  // Get user's watched companies for monitoring feature
  const watchedCompaniesRaw = await prisma.watchedCompany.findMany({
    where: { userId: session.user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyId: true,
      note: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const watchedCompanies = watchedCompaniesRaw.map((w) => ({
    ...w,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }));

  const serializedReports = reports.map((r) => ({
    id:         r.id,
    status:     r.status,
    targetType: r.targetType,
    ico:        r.ico,
    companyName: r.companyName,
    createdAt:  r.createdAt.toISOString(),
    sources:    r.sources,
  }));

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6" style={{ minHeight: "calc(100vh - 56px)" }}>
      <AddonCredits balance={userBalance} planName={userPlanName} />

      {isNewUser && <NewUserBanner />}

      <SearchSection />
      <ReportsTable reports={serializedReports} />
      <WatchedCompanies initialWatched={watchedCompanies} />
    </div>
  );
}
