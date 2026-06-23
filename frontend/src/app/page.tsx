import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import ReportForm from "@/components/ReportForm";
import ReportsTable from "@/components/ReportsTable";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Registro",
  description: "Registro.sk — previerka subjektov zo štátnych registrov SR",
};

async function getRecentReports(userId: string) {
  try {
    return await prisma.reportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 12,
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

  const stats = {
    total:      reports.length,
    completed:  reports.filter((r) => r.status === "COMPLETED" || r.status === "PARTIAL").length,
    processing: reports.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").length,
  };

  // Serialize dates for Client Component
  const serializedReports = reports.map((r) => ({
    id:         r.id,
    status:     r.status,
    targetType: r.targetType,
    ico:        r.ico,
    companyName: r.companyName,
    name:       r.name,
    surname:    r.surname,
    createdAt:  r.createdAt.toISOString(),
    sources:    r.sources,
  }));

  return (
    <div style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── HERO: compact centered search ─────────── */}
      <section
        className="flex flex-col items-center px-4 sm:px-6 pt-6 sm:pt-8 pb-6 sm:pb-8"
        style={{
          borderBottom: reports.length > 0 ? "1px solid var(--border)" : "none",
        }}
      >
        {/* Heading — compact */}
        <div className="text-center mb-5 fade-in">
          <h1
            className="text-xl sm:text-2xl font-bold mb-1.5"
            style={{
              color: "var(--text)",
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
            }}
          >
            Overenie subjektu
          </h1>
          <p className="text-xs sm:text-sm px-2" style={{ color: "var(--text-muted)" }}>
            Zadajte IČO alebo meno osoby a vyberte registre, ktoré chcete preveriť
          </p>
        </div>

        {/* Search form */}
        <div className="w-full" style={{ maxWidth: 560 }}>
          <Suspense fallback={null}>
            <ReportForm reportCount={stats.total} completedCount={stats.completed} processingCount={stats.processing} />
          </Suspense>
        </div>
      </section>

      {/* ── REPORTS TABLE (Client Component) ─────── */}
      <ReportsTable reports={serializedReports} />
    </div>
  );
}
