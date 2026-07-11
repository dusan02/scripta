import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import SearchSection from "@/components/SearchSection";
import ReportsTable from "@/components/ReportsTable";
import AddonCredits from "@/components/AddonCredits";

import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verifa — Dashboard",
  description: "Verifa.sk — previerka subjektov zo štátnych registrov SR",
};

async function getRecentReports(userId: string) {
  try {
    return await prisma.reportRequest.findMany({
      where: { userId },
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

    // Only redirect to pricing if user has NO plan AND trial expired or no credits
    // Users WITH an active plan see the AddonCredits component instead
    if (!hasPlan && (trialExpired || userBalance <= 0)) {
      redirect("/pricing");
    }
  }

  const reports = await getRecentReports(session.user.id);

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

      <SearchSection />
      <ReportsTable reports={serializedReports} />
    </div>
  );
}
