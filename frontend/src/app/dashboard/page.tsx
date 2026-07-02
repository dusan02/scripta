import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import SearchSection from "@/components/SearchSection";
import ReportsTable from "@/components/ReportsTable";
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
      <SearchSection />
      <ReportsTable reports={serializedReports} />
    </div>
  );
}
