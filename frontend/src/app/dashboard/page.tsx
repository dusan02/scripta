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

      {isNewUser && (
        <div style={{
          margin: "24px 0 8px",
          padding: "16px 20px",
          background: "var(--accent-subtle, #f0fdf4)",
          border: "1px solid var(--accent, #16a34a)",
          borderRadius: "12px",
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🎉</span>
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 4 }}>
              Vitajte vo Verifa! Máte 1 kredit na overenie firmy.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Zadajte IČO spoločnosti do vyhľadávacieho poľa — skontrolujeme ju v 25+ registroch a pripravíme Business Risk Report.
            </p>
          </div>
        </div>
      )}

      <SearchSection />
      <ReportsTable reports={serializedReports} />
    </div>
  );
}
