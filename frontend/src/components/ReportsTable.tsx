"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import CopyableText from "@/components/CopyableText";
import { getSourceShort, SOURCE_CATEGORIES, SOURCE_MAP } from "@/lib/sources";

interface ReportSource {
  sourceType: string;
  status: string;
}

interface Report {
  id: string;
  status: string;
  targetType: string;
  ico?: string | null;
  companyName?: string | null;
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
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [modal, setModal] = useState<{ type: "single" | "all"; reportId?: string; subject?: string } | null>(null);

  const handleDelete = useCallback((e: React.MouseEvent, reportId: string, subject: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModal({ type: "single", reportId, subject });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!modal) return;
    if (modal.type === "all") {
      setDeletingAll(true);
      try {
        const res = await fetch(`/api/reports?all=true`, { method: "DELETE" });
        if (res.ok) router.refresh();
      } catch {
        // ignore
      } finally {
        setDeletingAll(false);
      }
    } else if (modal.reportId) {
      setDeletingId(modal.reportId);
      try {
        const res = await fetch(`/api/reports?id=${modal.reportId}`, { method: "DELETE" });
        if (res.ok) router.refresh();
      } catch {
        // ignore
      } finally {
        setDeletingId(null);
      }
    }
    setModal(null);
  }, [modal, router]);

  const handleDeleteAll = useCallback(() => {
    setModal({ type: "all" });
  }, []);

  const handleSearchAgain = useCallback((e: React.MouseEvent, report: Report) => {
    e.preventDefault();
    e.stopPropagation();
    if (report.targetType === "COMPANY" && report.ico) {
      router.push(`/?ico=${report.ico}`);
    } else if (report.targetType === "PERSON") {
      const params = new URLSearchParams();
      if (report.name) params.set("name", report.name);
      if (report.surname) params.set("surname", report.surname);
      router.push(`/?${params.toString()}`);
    }
  }, [router]);

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 fade-in">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Zatiaľ žiadne reporty.
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
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {reports.length} záznamov
          </span>
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll}
            className="text-xs font-medium transition-colors hover:text-red-500"
            style={{ color: "var(--text-muted)" }}
          >
            {deletingAll ? "Mažem…" : "Vymazať všetko"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>

        {/* Header — desktop only */}
        <div
          className="hidden md:grid px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            gridTemplateColumns: "200px 1fr 100px 80px 60px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span>Subjekt</span>
          <span>Registre</span>
          <span>Čas</span>
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
                  borderBottom: idx < reports.length - 1 ? "1px solid var(--border)" : "none",
                  animationDelay: `${idx * 30}ms`,
                }}
              >
                {/* Desktop row */}
                <div
                  className="hidden md:grid items-center px-4 py-3"
                  style={{ gridTemplateColumns: "200px 1fr 100px 80px 60px" }}
                >
                  {/* Identifier */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-base flex-shrink-0">
                      {report.targetType === "COMPANY" ? "🏢" : "👤"}
                    </span>
                    <div className="min-w-0">
                      <span
                        className="text-sm font-semibold truncate block"
                        style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                      >
                        {report.targetType === "COMPANY" && report.ico ? (
                          <CopyableText text={report.ico} />
                        ) : (
                          identifier
                        )}
                      </span>
                      {report.targetType === "COMPANY" && report.companyName && (
                        <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                          {report.companyName}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Source chips — grouped by category */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {SOURCE_CATEGORIES.map((cat) => {
                      const catSources = report.sources.filter(s => {
                        const meta = SOURCE_MAP[s.sourceType];
                        return meta && meta.category === cat.id;
                      });
                      if (catSources.length === 0) return null;
                      return (
                        <div key={cat.id} className="flex items-center gap-1">
                          {catSources.map((s) => (
                            <span
                              key={s.sourceType}
                              title={`${s.sourceType}: ${s.status}`}
                              className="inline-flex items-center justify-center rounded text-[10px] font-bold px-2 py-1"
                              style={{
                                background: "var(--bg-muted)",
                                color: SOURCE_DOT_COLOR[s.status] ?? "var(--text-muted)",
                                border: "1px solid var(--border)",
                              }}
                            >
                              {getSourceShort(s.sourceType)}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>

                  {/* Time */}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {timeAgo(report.createdAt.toString())}
                  </span>

                  {/* Status */}
                  <div>
                    <StatusBadge status={report.status} size="sm" />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-3 pl-2">
                    <button
                      onClick={(e) => handleSearchAgain(e, report)}
                      title="Vyhľadať znova"
                      className="transition-colors hover:text-blue-500"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                        <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                      disabled={deletingId === report.id}
                      title="Vymazať"
                      className="transition-colors hover:text-red-500"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {deletingId === report.id ? (
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                    {canDownload && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                        <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    )}
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-secondary)" }}>
                      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                {/* Mobile card */}
                <div className="md:hidden px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {report.targetType === "COMPANY" ? "🏢" : "👤"}
                      </span>
                      <div className="min-w-0">
                        <span
                          className="text-sm font-semibold truncate block"
                          style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                        >
                          {report.targetType === "COMPANY" && report.ico ? (
                            <CopyableText text={report.ico} />
                          ) : (
                            identifier
                          )}
                        </span>
                        {report.targetType === "COMPANY" && report.companyName && (
                          <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                            {report.companyName}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={report.status} size="sm" />
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {SOURCE_CATEGORIES.map((cat) => {
                        const catSources = report.sources.filter(s => {
                          const meta = SOURCE_MAP[s.sourceType];
                          return meta && meta.category === cat.id;
                        });
                        if (catSources.length === 0) return null;
                        return (
                          <div key={cat.id} className="flex items-center gap-1">
                            {catSources.map((s) => (
                              <span
                                key={s.sourceType}
                                title={`${s.sourceType}: ${s.status}`}
                                className="inline-flex items-center justify-center rounded text-[10px] font-bold px-2 py-1"
                                style={{
                                  background: "var(--bg-muted)",
                                  color: SOURCE_DOT_COLOR[s.status] ?? "var(--text-muted)",
                                  border: "1px solid var(--border)",
                                }}
                              >
                                {getSourceShort(s.sourceType)}
                              </span>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <button
                        onClick={(e) => handleSearchAgain(e, report)}
                        title="Vyhľadať znova"
                        className="transition-colors hover:text-blue-500"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                          <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                        disabled={deletingId === report.id}
                        title="Vymazať"
                        className="transition-colors hover:text-red-500"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {deletingId === report.id ? (
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                            <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                        ) : (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(report.createdAt.toString())}
                      </span>
                      {canDownload && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                          <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      )}
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-secondary)" }}>
                        <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Confirm modal ── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setModal(null)}
        >
          <div
            className="rounded-2xl p-6 max-w-sm w-full fade-in"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-md)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{
                  width: 40,
                  height: 40,
                  background: "rgba(239,68,68,0.1)",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: "#ef4444" }}>
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                  {modal.type === "all" ? "Vymazať všetky reporty?" : "Vymazať report?"}
                </h3>
                {modal.subject && (
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {modal.subject}
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
              {modal.type === "all"
                ? "Túto akciu nie je možné vrátiť späť. Všetky reporty budú trvalo vymazané."
                : "Tento report bude trvalo vymazaný."}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "var(--bg-muted)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border)",
                }}
              >
                Zrušiť
              </button>
              <button
                onClick={confirmDelete}
                disabled={deletingId !== null || deletingAll}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2"
                style={{
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                }}
              >
                {(deletingId !== null || deletingAll) ? (
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : null}
                Vymazať
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
