"use client";

import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface ReportSource {
  sourceType: string;
  status: string;
}

interface Report {
  id: string;
  status: string;
  targetType: string;
  ico?: string | null;
  name?: string | null;
  surname?: string | null;
  createdAt: string;
  sources: ReportSource[];
}

const SOURCE_DOT_COLOR: Record<string, string> = {
  SUCCESS:     "#10b981",
  UNAVAILABLE: "#f59e0b",
  FAILED:      "#ef4444",
  PENDING:     "var(--border-strong)",
  PROCESSING:  "#3b82f6",
};

function timeAgo(date: string) {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "práve teraz";
  if (mins < 60) return `pred ${mins} min`;
  if (hours < 24) return `pred ${hours} h`;
  if (days === 1) return "včera";
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(date));
}

export default function ReportsTable({ reports }: { reports: Report[] }) {
  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 fade-in">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Zatiaľ žiadne reporty. Zadajte IČO vyššie.
        </p>
      </div>
    );
  }

  return (
    <section className="page pt-8 pb-16">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-sm font-semibold"
          style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
        >
          Posledné reporty
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {reports.length} záznamov
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>

        {/* Header */}
        <div
          className="grid px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            gridTemplateColumns: "1fr 140px 160px 100px 50px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span>Subjekt</span>
          <span>Registre</span>
          <span className="hidden md:block">Čas</span>
          <span>Stav</span>
          <span />
        </div>

        {/* Rows */}
        <div style={{ background: "var(--surface)" }}>
          {reports.map((report, idx) => {
            const identifier =
              report.targetType === "COMPANY"
                ? `IČO: ${report.ico}`
                : `${report.name} ${report.surname}`;
            const canDownload =
              report.status === "COMPLETED" || report.status === "PARTIAL";

            return (
              <Link
                key={report.id}
                href={`/reports/${report.id}`}
                className="report-row slide-up"
                style={{
                  gridTemplateColumns: "1fr 140px 160px 100px 50px",
                  borderBottom: idx < reports.length - 1 ? "1px solid var(--border)" : "none",
                  animationDelay: `${idx * 30}ms`,
                  padding: "12px 16px",
                  alignItems: "center",
                }}
              >
                {/* Identifier */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-base flex-shrink-0">
                    {report.targetType === "COMPANY" ? "🏢" : "👤"}
                  </span>
                  <span
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                  >
                    {identifier}
                  </span>
                </div>

                {/* Source chips */}
                <div className="flex items-center gap-1 flex-wrap">
                  {report.sources.map((s) => (
                    <span
                      key={s.sourceType}
                      title={`${s.sourceType}: ${s.status}`}
                      className="inline-flex items-center justify-center rounded text-[9px] font-bold px-1.5 py-0.5"
                      style={{
                        background: "var(--bg-muted)",
                        color: SOURCE_DOT_COLOR[s.status] ?? "var(--text-muted)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {s.sourceType === "INSOLVENCY" ? "INS" : s.sourceType}
                    </span>
                  ))}
                </div>

                {/* Time */}
                <span className="text-xs hidden md:block" style={{ color: "var(--text-muted)" }}>
                  {timeAgo(report.createdAt.toString())}
                </span>

                {/* Status */}
                <div>
                  <StatusBadge status={report.status} size="sm" />
                </div>

                {/* PDF + chevron */}
                <div className="flex items-center justify-end gap-1.5">
                  {canDownload && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                      <path
                        d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z"
                        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                      />
                    </svg>
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-muted)" }}>
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
