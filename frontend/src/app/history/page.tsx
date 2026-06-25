"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import CopyableText from "@/components/CopyableText";
import { getSourceShort, SOURCE_CATEGORIES, SOURCE_MAP, SOURCE_DOT_COLOR } from "@/lib/sources";

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

const STATUS_FILTERS = [
  { value: "ALL", label: "Všetky" },
  { value: "COMPLETED", label: "Dokončené" },
  { value: "PARTIAL", label: "Čiastočné" },
  { value: "PROCESSING", label: "Prebieha" },
  { value: "PENDING", label: "Čaká" },
  { value: "FAILED", label: "Zlyhané" },
];

function formatDate(date: string) {
  return new Intl.DateTimeFormat("sk-SK", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(date));
}

export default function HistoryPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "single" | "all"; reportId?: string; subject?: string } | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);

      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter]);

  useEffect(() => {
    const debounce = setTimeout(fetchReports, 300);
    return () => clearTimeout(debounce);
  }, [fetchReports]);

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
        if (res.ok) {
          setPage(1);
          fetchReports();
        }
      } catch {
        // ignore
      } finally {
        setDeletingAll(false);
      }
    } else if (modal.reportId) {
      setDeletingId(modal.reportId);
      try {
        const res = await fetch(`/api/reports?id=${modal.reportId}`, { method: "DELETE" });
        if (res.ok) fetchReports();
      } catch {
        // ignore
      } finally {
        setDeletingId(null);
      }
    }
    setModal(null);
  }, [modal, fetchReports]);

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

  return (
    <div className="page pt-6 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:opacity-80"
            style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
            História reportov
          </h1>
        </div>
        <button
          onClick={() => setModal({ type: "all" })}
          disabled={deletingAll}
          className="text-xs font-medium transition-colors hover:text-red-500"
          style={{ color: "var(--text-muted)" }}
        >
          {deletingAll ? "Mažem…" : "Vymazať všetko"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1 relative">
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          >
            <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Hľadať podľa IČO, mena, priezviska…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-lg pl-10 pr-4 py-2 text-sm outline-none transition-colors"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontFamily: "inherit",
            }}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1); }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{
                background: statusFilter === f.value ? "var(--accent-light)" : "var(--bg-muted)",
                color: statusFilter === f.value ? "var(--accent)" : "var(--text-muted)",
                border: `1px solid ${statusFilter === f.value ? "var(--accent-border)" : "var(--border)"}`,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {loading ? "Načítavam…" : `${total} záznamov`}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {/* Header — desktop */}
        <div
          className="hidden md:grid px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            gridTemplateColumns: "190px 1fr 120px 90px 90px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span>Subjekt</span>
          <span>Registre</span>
          <span>Dátum</span>
          <span>Stav</span>
          <span className="text-right">Akcia</span>
        </div>

        {/* Rows */}
        <div style={{ background: "var(--surface)" }}>
          {loading ? (
            <div className="px-4 py-12 text-center">
              <svg className="animate-spin w-5 h-5 mx-auto" viewBox="0 0 24 24" fill="none" style={{ color: "var(--text-muted)" }}>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
          ) : reports.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Žiadne reporty sa nenašli.
              </p>
            </div>
          ) : (
            reports.map((report, idx) => {
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
                  className="report-row"
                  style={{
                    borderBottom: idx < reports.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  {/* Desktop row */}
                  <div
                    className="hidden md:grid items-center px-4 py-3 transition-colors duration-100"
                    style={{ gridTemplateColumns: "190px 1fr 120px 90px 90px" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {report.targetType === "COMPANY" ? "🏢" : "👤"}
                      </span>
                      <div className="min-w-0">
                        {report.targetType === "COMPANY" && report.companyName ? (
                          <>
                            <span
                              className="text-sm font-semibold truncate block"
                              style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                            >
                              {report.companyName}
                            </span>
                            {report.ico && (
                              <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                                <CopyableText text={report.ico} label="IČO" />
                              </span>
                            )}
                          </>
                        ) : (
                          <span
                            className="text-sm font-semibold truncate block"
                            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                          >
                            {identifier}
                          </span>
                        )}
                      </div>
                    </div>

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

                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {formatDate(report.createdAt)}
                    </span>

                    <div>
                      <StatusBadge status={report.status} size="sm" />
                    </div>

                    <div className="flex items-center justify-end gap-2.5">
                      <button
                        onClick={(e) => handleSearchAgain(e, report)}
                        title="Vyhľadať znova"
                        className="transition-colors hover:text-blue-500"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      {canDownload && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                          title="Stiahnuť PDF"
                          className="transition-colors hover:text-green-600"
                          style={{ color: "var(--accent)" }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
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
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
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
                          {report.targetType === "COMPANY" && report.companyName ? (
                            <>
                              <span
                                className="text-sm font-semibold truncate block"
                                style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                              >
                                {report.companyName}
                              </span>
                              {report.ico && (
                                <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                                  <CopyableText text={report.ico} label="IČO" />
                                </span>
                              )}
                            </>
                          ) : (
                            <span
                              className="text-sm font-semibold truncate block"
                              style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                            >
                              {identifier}
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
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => handleSearchAgain(e, report)}
                          title="Vyhľadať znova"
                          className="transition-colors hover:text-blue-500"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
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
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {formatDate(report.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
            style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            ← Predošlá
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Strana {page} z {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
            style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            Ďalšia →
          </button>
        </div>
      )}

      {/* Confirm modal */}
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
                style={{ width: 40, height: 40, background: "var(--danger-bg)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: "var(--danger)" }}>
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
                style={{ background: "var(--bg-muted)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                Zrušiť
              </button>
              <button
                onClick={confirmDelete}
                disabled={deletingId !== null || deletingAll}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2"
                style={{ background: "var(--danger)", color: "var(--accent-button-text)", border: "none" }}
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
    </div>
  );
}
