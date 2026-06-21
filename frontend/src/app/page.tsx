import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import ReportForm from "@/components/ReportForm";
import ReportsTable from "@/components/ReportsTable";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Veriso.sk — previerka subjektov zo štátnych registrov SR",
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
    name:       r.name,
    surname:    r.surname,
    createdAt:  r.createdAt.toISOString(),
    sources:    r.sources,
  }));

  return (
    <div style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── HERO: centered search ─────────────────── */}
      <section
        className="flex flex-col items-center px-6 pt-16 pb-12"
        style={{
          borderBottom: reports.length > 0 ? "1px solid var(--border)" : "none",
        }}
      >
        {/* Heading */}
        <div className="text-center mb-8 fade-in">
          <h1
            className="text-3xl sm:text-4xl font-bold mb-3"
            style={{
              color: "var(--text)",
              letterSpacing: "-0.04em",
              lineHeight: 1.1,
            }}
          >
            Overenie subjektu
          </h1>
          <p className="text-sm whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
            Zadajte IČO alebo meno osoby a vyberte registre, ktoré chcete preveriť
          </p>
        </div>

        {/* Search form */}
        <div className="w-full" style={{ maxWidth: 620 }}>
          <ReportForm />
        </div>

        {/* Quick stats */}
        {reports.length > 0 && (
          <div
            className="flex items-center gap-1 mt-8 text-xs fade-in"
            style={{ animationDelay: "120ms", color: "var(--text-muted)" }}
          >
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              {stats.total}
            </span>
            <span>reportov</span>
            <span className="mx-2" style={{ color: "var(--border-strong)" }}>·</span>
            <span className="font-semibold" style={{ color: "#10b981" }}>
              {stats.completed}
            </span>
            <span>dokončených</span>
            {stats.processing > 0 && (
              <>
                <span className="mx-2" style={{ color: "var(--border-strong)" }}>·</span>
                <span className="font-semibold" style={{ color: "#3b82f6" }}>
                  {stats.processing}
                </span>
                <span>prebieha</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── REPORTS TABLE (Client Component) ─────── */}
      <ReportsTable reports={serializedReports} />
    </div>
  );
}
