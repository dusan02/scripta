"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import CopyableText from "@/components/CopyableText";
import SourceBadges from "@/components/SourceBadges";
import { useT, useLang } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import { formatCompanyName } from "@/lib/format";
import toast from "react-hot-toast";
import ConfirmModal from "@/components/ConfirmModal";

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
  { value: "ALL", key: "history.vsetky" },
  { value: "COMPLETED", key: "history.dokoncene" },
  { value: "PARTIAL", key: "history.ciastocne" },
  { value: "PROCESSING", key: "history.prebieha" },
  { value: "PENDING", key: "history.caka" },
  { value: "FAILED", key: "history.zlyhanie" },
];

function formatDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(date));
}

export default function HistoryPage() {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "single" | "all" | "bulk"; reportId?: string; subject?: string } | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fadingId, setFadingId] = useState<string | null>(null);

  const hasActiveFilters = search || statusFilter !== "ALL" || dateFrom || dateTo;

  const toggleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  }, [sortBy]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === reports.length) return new Set();
      return new Set(reports.map(r => r.id));
    });
  }, [reports]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("ALL");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, []);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(limit));
      if (search) params.set("search", search);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/reports?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      toast.error(t("history.chybaNacitania"));
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, statusFilter, sortBy, sortOrder, dateFrom, dateTo]);

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
          setSelectedIds(new Set());
          setPage(1);
          fetchReports();
        }
      } catch {
        toast.error(t("history.chybaMazania"));
      } finally {
        setDeletingAll(false);
      }
    } else if (modal.type === "bulk") {
      setDeletingAll(true);
      try {
        const ids = Array.from(selectedIds).join(",");
        const res = await fetch(`/api/reports?ids=${ids}`, { method: "DELETE" });
        if (res.ok) {
          setSelectedIds(new Set());
          fetchReports();
        }
      } catch {
        toast.error(t("history.chybaMazania"));
      } finally {
        setDeletingAll(false);
      }
    } else if (modal.reportId) {
      setFadingId(modal.reportId);
      setDeletingId(modal.reportId);
      try {
        const res = await fetch(`/api/reports?id=${modal.reportId}`, { method: "DELETE" });
        if (res.ok) {
          setTimeout(() => {
            setFadingId(null);
            fetchReports();
          }, 300);
        } else {
          setFadingId(null);
        }
      } catch {
        toast.error(t("history.chybaMazania"));
        setFadingId(null);
      } finally {
        setDeletingId(null);
      }
    }
    setModal(null);
  }, [modal, fetchReports, selectedIds]);

  const [retryingId, setRetryingId] = useState<string | null>(null);

  const handleSearchAgain = useCallback(async (e: React.MouseEvent, report: Report) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[handleSearchAgain] clicked, report:", report.id, "ico:", report.ico, "sources:", report.sources.map(s => s.sourceType));
    setRetryingId(report.id);
    try {
      const body: Record<string, unknown> = {
        targetType: "COMPANY",
        sources: report.sources.map(s => s.sourceType),
        ico: report.ico,
      };
      console.log("[handleSearchAgain] POST body:", JSON.stringify(body));
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log("[handleSearchAgain] response:", res.status, data);
      if (res.ok && data.reportRequestId) {
        router.push(`/reports/${data.reportRequestId}`);
      } else {
        toast.error(data.error || t("history.chybaZopakovania"));
      }
    } catch (err) {
      console.error("[handleSearchAgain] error:", err);
      toast.error(t("history.chybaZopakovania"));
    } finally {
      setRetryingId(null);
    }
  }, [router, t]);

  return (
    <div className="page pt-8 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 relative">
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
        </div>
        <h1 className="text-2xl font-bold tracking-tight absolute left-1/2 -translate-x-1/2" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
          {t("history.historiaReportov")}
        </h1>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setModal({ type: "bulk" })}
              disabled={deletingAll}
              className="text-xs font-medium transition-colors hover:text-red-500"
              style={{ color: "var(--danger-text)" }}
            >
              {t("history.vymazatVybrane")} ({selectedIds.size})
            </button>
          )}
          <button
            onClick={() => setModal({ type: "all" })}
            disabled={deletingAll}
            className="text-xs font-medium transition-colors hover:text-red-500"
            style={{ color: "var(--danger-text)" }}
          >
            {deletingAll ? t("history.mazem") : t("history.vymazatVsetko")}
          </button>
        </div>
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
            placeholder={t("history.hladatPodla")}
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
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="rounded-lg px-3 py-2 text-xs outline-none transition-colors"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit" }}
            title={t("history.odDátumu")}
          />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="rounded-lg px-3 py-2 text-xs outline-none transition-colors"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit" }}
            title={t("history.doDátumu")}
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
              {t(f.key)}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {loading ? t("history.nacitavam") : t("history.zaznamov", { n: total })}
        </span>
        {hasActiveFilters && !loading && reports.length === 0 && (
          <button
            onClick={clearFilters}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            {t("history.vymazaťFiltre")}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        {/* Header — desktop */}
        <div
          className="hidden md:grid px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider gap-3 sticky top-0 z-10"
          style={{
            gridTemplateColumns: "32px 200px minmax(0, 1fr) 130px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span className="flex items-center justify-center">
            <input
              type="checkbox"
              checked={selectedIds.size === reports.length && reports.length > 0}
              onChange={toggleSelectAll}
              className="cursor-pointer"
              style={{ accentColor: "var(--accent)" }}
            />
          </span>
          <button
            onClick={() => toggleSort("companyName")}
            className="text-center flex items-center justify-center gap-1 hover:opacity-80 transition-opacity"
          >
            {t("history.subjekt")}
            {sortBy === "companyName" && (
              <span className="text-[8px]">{sortOrder === "asc" ? "▲" : "▼"}</span>
            )}
          </button>
          <span>{t("history.registre")}</span>
          <button
            onClick={() => toggleSort("createdAt")}
            className="text-right flex items-center justify-end gap-1 hover:opacity-80 transition-opacity"
          >
            {t("history.stav")}
            {sortBy === "createdAt" && (
              <span className="text-[8px]">{sortOrder === "asc" ? "▲" : "▼"}</span>
            )}
          </button>
        </div>

        {/* Rows */}
        <div style={{ background: "var(--surface)" }}>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="hidden md:grid items-center px-4 py-3 gap-3"
                style={{
                  gridTemplateColumns: "32px 200px minmax(0, 1fr) 130px",
                  borderBottom: i < 4 ? "1px solid var(--border)" : "none",
                }}
              >
                <div className="h-4 w-4 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                <div className="flex flex-col items-center gap-2">
                  <div className="h-5 w-5 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-2 w-1/2 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                </div>
                <div className="flex gap-1.5">
                  <div className="h-5 w-12 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-5 w-10 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-5 w-8 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  <div className="flex gap-1.5">
                    <div className="h-4 w-4 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                    <div className="h-4 w-4 rounded animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  </div>
                </div>
              </div>
            ))
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 fade-in">
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>{hasActiveFilters ? "🔍" : "📋"}</div>
              <p className="text-base font-semibold mb-2" style={{ color: "var(--text)" }}>
                {hasActiveFilters ? t("history.ziadneVysledky") : t("history.ziadneNenasli")}
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={clearFilters}
                  className="btn-primary mt-4"
                  style={{ textDecoration: "none" }}
                >
                  {t("history.vymazaťFiltre")}
                </button>
              ) : (
                <Link
                  href="/"
                  className="btn-primary mt-4"
                  style={{ textDecoration: "none" }}
                >
                  {t("history.spustitHladanie")}
                </Link>
              )}
            </div>
          ) : (
            reports.map((report, idx) => {
              const identifier =
                report.targetType === "COMPANY"
                  ? `${t("common.ico")}: ${report.ico}`
                  : `${report.name} ${report.surname}`;
              const canDownload =
                report.status === "COMPLETED" || report.status === "PARTIAL";

              return (
                <Link
                  key={report.id}
                  href={`/reports/${report.id}`}
                  className="report-row stagger-row"
                  style={{
                    borderBottom: idx < reports.length - 1 ? "1px solid var(--border)" : "none",
                    animationDelay: `${idx * 30}ms`,
                    opacity: fadingId === report.id ? 0 : 1,
                    transition: "opacity 300ms ease-out",
                    background: idx % 2 === 1 ? "var(--bg-subtle)" : "transparent",
                  }}
                >
                  {/* Desktop row */}
                  <div
                    className="hidden md:grid items-center px-4 py-3 transition-colors duration-100 gap-3"
                    style={{ gridTemplateColumns: "32px 200px minmax(0, 1fr) 130px" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-muted)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 1 ? "var(--bg-subtle)" : "transparent"; }}
                  >
                    <span className="flex items-center justify-center" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(report.id); }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(report.id)}
                        onChange={() => toggleSelect(report.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer"
                        style={{ accentColor: "var(--accent)" }}
                      />
                    </span>
                    <div className="flex flex-col items-center gap-1 min-w-0">
                      <span className="text-base flex-shrink-0">
                        {report.targetType === "COMPANY" ? "🏢" : "👤"}
                      </span>
                      <div className="min-w-0 w-full text-center">
                        {report.targetType === "COMPANY" && report.companyName ? (
                          <>
                            <span
                              className="text-sm font-semibold block"
                              style={{ color: "var(--text)", letterSpacing: "-0.01em", wordBreak: "break-word" }}
                            >
                              {formatCompanyName(report.companyName).map((line, i) => (
                                <span key={i} className="block">{line}</span>
                              ))}
                            </span>
                            {report.ico && (
                              <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                                <CopyableText text={report.ico} label={t("common.ico")} />
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
                      <SourceBadges sources={report.sources} />
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {formatDate(report.createdAt, locale)}
                      </span>
                      <StatusBadge status={report.status} size="sm" />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleSearchAgain(e, report)}
                          disabled={retryingId === report.id}
                          title={t("history.spustitHladanie")}
                          className="transition-colors hover:text-blue-500 p-1.5 rounded-md"
                          style={{ color: "var(--info-text)" }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M3 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        {canDownload && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                            title={t("history.stiahnutPdf")}
                            className="transition-colors hover:text-green-600 p-1.5 rounded-md"
                            style={{ color: "var(--accent)" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                          disabled={deletingId === report.id}
                          title={t("history.vymazat")}
                          className="transition-colors hover:text-red-500 p-1.5 rounded-md"
                          style={{ color: "var(--danger-text)" }}
                        >
                          {deletingId === report.id ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3.5">
                    <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
                      <span className="text-base flex-shrink-0">
                        {report.targetType === "COMPANY" ? "🏢" : "👤"}
                      </span>
                      <div className="min-w-0 w-full text-center">
                        {report.targetType === "COMPANY" && report.companyName ? (
                          <>
                            <span
                              className="text-sm font-semibold block"
                              style={{ color: "var(--text)", letterSpacing: "-0.01em", wordBreak: "break-word" }}
                            >
                              {formatCompanyName(report.companyName).map((line, i) => (
                                <span key={i} className="block">{line}</span>
                              ))}
                            </span>
                            {report.ico && (
                              <span className="text-[11px] truncate block" style={{ color: "var(--text-muted)" }}>
                                <CopyableText text={report.ico} label={t("common.ico")} />
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
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StatusBadge status={report.status} size="sm" />
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {formatDate(report.createdAt, locale)}
                      </span>
                    </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <SourceBadges sources={report.sources} />
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={(e) => handleSearchAgain(e, report)}
                          disabled={retryingId === report.id}
                          title={t("history.spustitHladanie")}
                          className="transition-colors hover:text-blue-500"
                          style={{ color: "var(--info-text)" }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M3 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                          disabled={deletingId === report.id}
                          title={t("history.vymazat")}
                          className="transition-colors hover:text-red-500"
                          style={{ color: "var(--danger-text)" }}
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
                          {formatDate(report.createdAt, locale)}
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
            ← {t("history.predosla").replace("← ", "")}
          </button>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("history.strana", { page, total: totalPages })}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
            style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
          >
            {t("history.dalsia").replace(" →", "")} →
          </button>
        </div>
      )}

      {/* Confirm modal */}
      <ConfirmModal
        open={!!modal}
        title={
          modal?.type === "all" ? t("history.vymazatVsetkyOtaznik")
          : modal?.type === "bulk" ? `${t("history.vymazatVybrane")}? (${selectedIds.size})`
          : t("history.vymazatReportOtaznik")
        }
        subject={modal?.subject}
        message={
          modal?.type === "all" || modal?.type === "bulk" ? t("history.nedaVratit") : t("history.reportVymazany")
        }
        confirmLabel={t("history.vymazat")}
        cancelLabel={t("history.zrusit")}
        onConfirm={confirmDelete}
        onCancel={() => setModal(null)}
        loading={deletingId !== null || deletingAll}
      />
    </div>
  );
}
