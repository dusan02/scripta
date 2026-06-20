import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import ReportForm from "@/components/ReportForm";
import StatusBadge from "@/components/StatusBadge";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Scripta.sk — prehľad vašich reportov a nový Evidence Binder",
};

export const dynamic = "force-dynamic";

import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";

// For demo purposes: load reports without auth (replace with getCurrentUser once NextAuth is wired)
async function getRecentReports(userId: string) {
  try {
    return await prisma.reportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        sources: {
          select: { sourceType: true, status: true },
        },
      },
    });
  } catch {
    return [];
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function ReportIdentifier(report: { targetType: string; ico?: string | null; name?: string | null; surname?: string | null }) {
  if (report.targetType === "COMPANY") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm">🏢</span>
        <span className="font-medium text-slate-200">IČO: {report.ico}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">👤</span>
      <span className="font-medium text-slate-200">{report.name} {report.surname}</span>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }
  const reports = await getRecentReports(session.user.id);

  const stats = {
    total: reports.length,
    completed: reports.filter((r) => r.status === "COMPLETED" || r.status === "PARTIAL").length,
    processing: reports.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").length,
  };

  return (
    <div className="page-container">
      {/* Hero */}
      <div className="mb-10 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            B2B Legal-Tech SaaS
          </div>
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight">
          Evidence Binder{" "}
          <span className="text-gradient">pre advokátov</span>
        </h1>
        <p className="mt-3 text-slate-400 max-w-2xl text-base leading-relaxed">
          Automaticky stiahne výpisy zo štátnych registrov SR, vygeneruje titulnú stranu so semaformi
          nálezov a zlúči všetko do jedného PDF pripraveného na odovzdanie klientovi.
        </p>
      </div>

      {/* Stats bar */}
      {reports.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-8 animate-slide-up">
          {[
            { label: "Celkom reportov", value: stats.total, color: "text-slate-300" },
            { label: "Dokončených", value: stats.completed, color: "text-emerald-400" },
            { label: "Prebieha", value: stats.processing, color: "text-blue-400" },
          ].map((stat) => (
            <div key={stat.label} className="glass-card p-4 text-center">
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Form */}
        <div className="lg:col-span-2">
          <ReportForm />

          {/* Info card */}
          <div
            className="mt-4 p-4 rounded-xl text-xs text-slate-500 space-y-1.5"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="font-semibold text-slate-400 mb-2">ℹ Ako to funguje</div>
            <div>1. Zadáte IČO alebo osobu a vyberiete registre</div>
            <div>2. Systém automaticky stiahne výpisy</div>
            <div>3. Vygeneruje sa titulná strana so semaformi</div>
            <div>4. Stiahnete hotové PDF — Evidence Binder</div>
          </div>
        </div>

        {/* Reports list */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h2 className="section-title">Posledné reporty</h2>
            <span className="text-xs text-slate-600">{reports.length} záznamov</span>
          </div>

          {reports.length === 0 ? (
            <div
              className="glass-card p-12 text-center animate-fade-in"
            >
              <div className="text-5xl mb-4">📋</div>
              <div className="text-slate-400 font-medium">Zatiaľ žiadne reporty</div>
              <div className="text-slate-600 text-sm mt-1">
                Vytvorte prvý Evidence Binder formulárom vľavo
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {reports.map((report, idx) => (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="glass-card-hover block p-4 animate-slide-up"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <ReportIdentifier {...report} />
                      <div className="flex flex-wrap gap-2 mt-2">
                        {report.sources.map((s) => (
                          <span
                            key={s.sourceType}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              s.status === "SUCCESS"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : s.status === "UNAVAILABLE"
                                ? "bg-amber-500/10 text-amber-400"
                                : s.status === "FAILED"
                                ? "bg-red-500/10 text-red-400"
                                : "bg-slate-500/10 text-slate-500"
                            }`}
                          >
                            {s.sourceType}
                          </span>
                        ))}
                      </div>
                      <div className="text-xs text-slate-600 mt-1.5">
                        {formatDate(report.createdAt)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={report.status} />
                      {(report.status === "COMPLETED" || report.status === "PARTIAL") && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                            <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          PDF
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
