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
    return await prisma.reportRequest.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        sources: { select: { sourceType: true, status: true } },
      },
    });
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
    const trialExpired = user.trialEndsAt ? user.trialEndsAt < now : false;
    const hasPlan = !!user.planName;
    userPlanName = user.planName;

    const wallet = await prisma.wallet.findUnique({
      where: { userId: session.user.id },
      select: { balance: true },
    });
    userBalance = wallet ? Number(wallet.balance) : 0;

    // Also check CreditBatch for remaining credits
    const creditBatch = await prisma.creditBatch.findFirst({
      where: { userId: session.user.id, remaining: { gt: 0 }, expiresAt: { gt: now } },
    });
    const hasCredits = userBalance > 0 || !!creditBatch;

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
