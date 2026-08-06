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
import {
  FileDownloadIcon,
  RefreshIcon,
  TrashIcon,
  SpinnerIcon,
  ArrowLeftIcon,
  SearchIcon,
  StopIcon,
} from "@/components/icons";

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
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "single" | "all" | "bulk" | "cancel"; reportId?: string; subject?: string } | null>(null);
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

  const handleCancel = useCallback((e: React.MouseEvent, reportId: string, subject: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModal({ type: "cancel", reportId, subject });
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

  const confirmCancel = useCallback(async () => {
    if (!modal?.reportId) return;
    setCancellingId(modal.reportId);
    try {
      const res = await fetch(`/api/reports/${modal.reportId}/cancel`, { method: "POST" });
      if (res.ok) {
        toast.success(t("history.zrusitReport"));
        fetchReports();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("history.chybaMazania"));
      }
    } catch {
      toast.error(t("history.chybaMazania"));
    } finally {
      setCancellingId(null);
      setModal(null);
    }
  }, [modal, fetchReports, t]);

  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [creditsModalMsg, setCreditsModalMsg] = useState("");

  const handleSearchAgain = useCallback(async (e: React.MouseEvent, report: Report) => {
    e.preventDefault();
    e.stopPropagation();
    setRetryingId(report.id);
    try {
      const body: Record<string, unknown> = {
        targetType: "COMPANY",
        sources: report.sources.map(s => s.sourceType),
        ico: report.ico,
      };
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.reportRequestId) {
        router.push(`/reports/${data.reportRequestId}`);
      } else if (res.status === 402) {
        setCreditsModalMsg(data.error || t("history.chybaZopakovania"));
        setShowCreditsModal(true);
      } else {
        toast.error(data.error || t("history.chybaZopakovania"));
      }
    } catch {
      toast.error(t("history.chybaZopakovania"));
    } finally {
      setRetryingId(null);
    }
  }, [router, t]);

  return (
    <div className="page pt-8 pb-16 max-w-[1200px] mx-auto px-4 sm:px-6">
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:opacity-80"
              style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              <ArrowLeftIcon size={14} />
            </Link>
          </div>
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
        <h1 className="text-2xl font-bold tracking-tight text-center mt-3 hidden md:block" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
          {t("history.historiaReportov")}
        </h1>
        <h1 className="text-xl font-bold tracking-tight mt-3 md:hidden" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
          {t("history.historiaReportov")}
        </h1>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-4">
        {/* Search input — full width */}
        <div className="relative">
          <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
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
        {/* Date range — side by side, full width on mobile */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs outline-none transition-colors"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit" }}
            title={t("history.odDátumu")}
          />
          <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-xs outline-none transition-colors"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "inherit" }}
            title={t("history.doDátumu")}
          />
        </div>
        {/* Status filter chips — wrap on new line, full width */}
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
                  href="/dashboard"
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
                    className="hidden md:grid items-center px-4 py-3 transition-colors duration-100 gap-3 hover:bg-[var(--bg-muted)]"
                    style={{ gridTemplateColumns: "32px 200px minmax(0, 1fr) 130px" }}
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
                          className="action-btn action-btn-retry p-1.5 rounded-md"
                          style={{ color: "var(--info-text)" }}
                        >
                          {retryingId === report.id ? <SpinnerIcon size={14} /> : <RefreshIcon size={14} />}
                        </button>
                        {canDownload && (
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                            title={t("history.stiahnutPdf")}
                            className="action-btn action-btn-download p-1.5 rounded-md"
                            style={{ color: "var(--accent)" }}
                          >
                            <FileDownloadIcon size={14} />
                          </button>
                        )}
                        {(report.status === "PENDING" || report.status === "PROCESSING") && (
                          <button
                            onClick={(e) => handleCancel(e, report.id, report.companyName || report.ico || identifier)}
                            disabled={cancellingId === report.id}
                            title={t("history.zrusitReport")}
                            className="action-btn p-1.5 rounded-md"
                            style={{ color: "var(--warning)" }}
                          >
                            {cancellingId === report.id ? <SpinnerIcon size={14} /> : <StopIcon size={14} />}
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                          disabled={deletingId === report.id}
                          title={t("history.vymazat")}
                          className="action-btn action-btn-delete p-1.5 rounded-md"
                          style={{ color: "var(--danger-text)" }}
                        >
                          {deletingId === report.id ? <SpinnerIcon size={14} /> : <TrashIcon size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mobile card */}
                  <div className="md:hidden px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: icon + name */}
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        <span className="text-base flex-shrink-0 mt-0.5">
                          {report.targetType === "COMPANY" ? "🏢" : "👤"}
                        </span>
                        <div className="min-w-0">
                          {report.targetType === "COMPANY" && report.companyName ? (
                            <>
                              <span
                                className="text-sm font-semibold block leading-snug"
                                style={{ color: "var(--text)", letterSpacing: "-0.01em", wordBreak: "break-word" }}
                              >
                                {formatCompanyName(report.companyName).map((line, i) => (
                                  <span key={i} className="block">{line}</span>
                                ))}
                              </span>
                              {report.ico && (
                                <span className="text-[11px] block mt-0.5" style={{ color: "var(--text-muted)" }}>
                                  <CopyableText text={report.ico} label={t("common.ico")} />
                                </span>
                              )}
                            </>
                          ) : (
                            <span
                              className="text-sm font-semibold block"
                              style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
                            >
                              {identifier}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Right: status + date */}
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
                          className="action-btn action-btn-retry"
                          style={{ color: "var(--info-text)" }}
                        >
                          {retryingId === report.id ? <SpinnerIcon size={16} /> : <RefreshIcon size={16} />}
                        </button>
                        {(report.status === "PENDING" || report.status === "PROCESSING") && (
                          <button
                            onClick={(e) => handleCancel(e, report.id, report.companyName || report.ico || identifier)}
                            disabled={cancellingId === report.id}
                            title={t("history.zrusitReport")}
                            className="action-btn"
                            style={{ color: "var(--warning)" }}
                          >
                            {cancellingId === report.id ? <SpinnerIcon size={16} /> : <StopIcon size={16} />}
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                          disabled={deletingId === report.id}
                          title={t("history.vymazat")}
                          className="action-btn action-btn-delete"
                          style={{ color: "var(--danger-text)" }}
                        >
                          {deletingId === report.id ? <SpinnerIcon size={16} /> : <TrashIcon size={16} />}
                        </button>
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

      {/* Cancel modal — pre prebiehajúce reporty */}
      <ConfirmModal
        open={modal?.type === "cancel"}
        title={t("history.zrusitReportOtaznik")}
        subject={modal?.subject}
        message={t("history.zrusitReportMsg")}
        confirmLabel={t("history.ano")}
        cancelLabel={t("history.nie")}
        onConfirm={confirmCancel}
        onCancel={() => setModal(null)}
        loading={cancellingId !== null}
        variant="warning"
      />

      {/* Delete confirm modal */}
      <ConfirmModal
        open={!!modal && modal.type !== "cancel"}
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

      {/* Credits modal — shown when user has insufficient credits */}
      {showCreditsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          onClick={() => setShowCreditsModal(false)}
        >
          <div
            className="rounded-xl shadow-2xl max-w-sm w-full p-6 text-center"
            style={{ background: "var(--bg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <span className="text-3xl">💳</span>
            </div>
            <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
              {creditsModalMsg}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => setShowCreditsModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--bg-muted)", color: "var(--text)" }}
              >
                {t("history.zrusit")}
              </button>
              <button
                onClick={() => {
                  setShowCreditsModal(false);
                  router.push("/credits");
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: "var(--accent)" }}
              >
                {t("history.kredity")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
