"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";
import CopyableText from "@/components/CopyableText";
import { ENABLED_SOURCES } from "@/lib/sources";
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

function timeAgo(date: string, t: (key: string, params?: Record<string, string | number>) => string, locale: string) {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 1) return t("reports.praveTeraz");
  if (mins < 60) return t("reports.predMin", { n: mins });
  if (hours < 24) return t("reports.predH", { n: hours });
  if (days === 1) return t("reports.vcera");
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(date));
}

export default function ReportsTable({ reports }: { reports: Report[] }) {
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [localReports, setLocalReports] = useState<Report[]>(reports);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [modal, setModal] = useState<{ type: "single" | "all"; reportId?: string; subject?: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => { setLocalReports(reports); }, [reports]);
  
  useEffect(() => {
    setMounted(true);
    // Refresh server data when dashboard becomes visible (e.g. navigating back from report)
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    router.refresh();
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);
  const timeAgoSafe = useMemo(
    () => (date: string) => mounted ? timeAgo(date, t, locale) : "",
    [mounted, t, locale]
  );

  const handleDelete = useCallback((e: React.MouseEvent, reportId: string, subject: string) => {
    e.preventDefault();
    e.stopPropagation();
    setModal({ type: "single", reportId, subject });
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!modal) return;
    if (modal.type === "all") {
      setDeletingAll(true);
      setLocalReports([]); // Optimistic update
      try {
        const res = await fetch(`/api/reports?all=true`, { method: "DELETE" });
        if (res.ok) router.refresh();
      } catch {
        toast.error(t("history.chybaMazania"));
      } finally {
        setDeletingAll(false);
      }
    } else if (modal.reportId) {
      setDeletingId(modal.reportId);
      setLocalReports(prev => prev.filter(r => r.id !== modal.reportId)); // Optimistic update
      try {
        const res = await fetch(`/api/reports?id=${modal.reportId}`, { method: "DELETE" });
        if (res.ok) router.refresh();
      } catch {
        toast.error(t("history.chybaMazania"));
      } finally {
        setDeletingId(null);
      }
    }
    setModal(null);
  }, [modal, router]);

  const handleRetry = useCallback(async (e: React.MouseEvent, report: Report) => {
    e.preventDefault();
    e.stopPropagation();
    setRetryingId(report.id);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "COMPANY",
          ico: report.ico,
          sources: report.sources.map(s => s.sourceType),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/reports/${data.reportRequestId}`);
      } else {
        toast.error(data.error || t("reports.nepodariloZopakovat"));
      }
    } catch {
      toast.error(t("reports.sietovaChyba"));
    } finally {
      setRetryingId(null);
    }
  }, [router, t]);

  const handleDeleteAll = useCallback(() => {
    setModal({ type: "all" });
  }, []);

  if (localReports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 fade-in">
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>📋</div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("reports.ziadneReporty")}
        </p>
      </div>
    );
  }

  return (
    <section className="page pt-8 pb-16">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--text)", letterSpacing: "-0.01em" }}
          >
            {t("reports.posledne")}
          </h2>
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll}
            className="text-xs font-medium transition-colors hover:text-red-500"
            style={{ color: "var(--text-muted)" }}
          >
            {deletingAll ? t("reports.mazem") : t("reports.vymazatVsetko")}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("reports.zaznamov", { n: localReports.length })}
          </span>
          <Link
            href="/history"
            className="text-xs font-medium transition-colors hover:opacity-80 flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            {t("reports.zobrazitHistoriu")}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>

        {/* Header — desktop only */}
        <div
          className="hidden md:grid px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider gap-3"
          style={{
            gridTemplateColumns: "200px minmax(0, 1fr) 130px",
            background: "var(--bg-subtle)",
            borderBottom: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
        >
          <span className="text-center">{t("reports.subjekt")}</span>
          <span>{t("reports.registre")}</span>
          <span className="text-right">{t("reports.stav")}</span>
        </div>

        {/* Rows */}
        <div style={{ background: "var(--surface)" }}>
          {localReports.map((report, idx) => {
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
                  borderBottom: idx < localReports.length - 1 ? "1px solid var(--border)" : "none",
                  animationDelay: `${idx * 30}ms`,
                }}
              >
                {/* Desktop row */}
                <div
                  className="hidden md:grid items-center px-4 py-3 transition-colors duration-100 gap-3"
                  style={{ gridTemplateColumns: "200px minmax(0, 1fr) 130px" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-subtle)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {/* Identifier — icon centered above company name */}
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

                  {/* Source chips — compact if all selected */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {report.sources.length >= ENABLED_SOURCES.length ? (
                      <span
                        className="inline-flex items-center rounded text-[10px] font-bold px-2 py-1"
                        style={{ background: "var(--bg-muted)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                      >
                        {report.sources.length}/{ENABLED_SOURCES.length} {t("reports.registre").toLowerCase()}
                      </span>
                    ) : (
                      <SourceBadges sources={report.sources} />
                    )}
                  </div>

                  {/* Time + Status + Actions — merged column */}
                  <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {timeAgoSafe(report.createdAt.toString())}
                      </span>
                      <StatusBadge status={report.status} size="sm" />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                        title={t("reports.zobrazitReport")}
                        className="transition-all duration-150 rounded-md p-0.5"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-muted)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      {canDownload && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                          title={t("reports.stiahnutPdf")}
                          className="transition-all duration-150 rounded-md p-0.5"
                          style={{ color: "var(--accent)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-light)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                      {canDownload && (
                        <button
                          onClick={(e) => handleRetry(e, report)}
                          disabled={retryingId === report.id}
                          title={t("reports.regenerovatReport")}
                          className="transition-all duration-150 rounded-md p-0.5"
                          style={{ color: "var(--text-secondary)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-muted)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      {report.status === "FAILED" && (
                        <button
                          onClick={(e) => handleRetry(e, report)}
                          disabled={retryingId === report.id}
                          title={t("reports.zopakovatReport")}
                          className="transition-all duration-150 rounded-md p-0.5"
                          style={{ color: "var(--warning)" }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--warning-bg)"; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                        disabled={deletingId === report.id}
                        title={t("reports.vymazat")}
                        className="transition-all duration-150 rounded-md p-0.5"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--danger-bg)"; (e.currentTarget as HTMLElement).style.color = "var(--danger)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
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
                    <StatusBadge status={report.status} size="sm" />
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {report.sources.length >= ENABLED_SOURCES.length ? (
                        <span
                          className="inline-flex items-center rounded text-[10px] font-bold px-2 py-1"
                          style={{ background: "var(--bg-muted)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                        >
                          {report.sources.length}/{ENABLED_SOURCES.length}
                        </span>
                      ) : (
                        <SourceBadges sources={report.sources} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/reports/${report.id}`); }}
                        title={t("reports.zobrazitReport")}
                        className="transition-all duration-150 rounded-md p-0.5"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      {canDownload && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                          <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      )}
                      {canDownload && (
                        <button
                          onClick={(e) => handleRetry(e, report)}
                          disabled={retryingId === report.id}
                          title={t("reports.regenerovatReport")}
                          className="transition-all duration-150 rounded-md p-0.5"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      {report.status === "FAILED" && (
                        <button
                          onClick={(e) => handleRetry(e, report)}
                          disabled={retryingId === report.id}
                          title={t("reports.zopakovatReport")}
                          className="transition-all duration-150 rounded-md p-0.5"
                          style={{ color: "var(--warning)" }}
                        >
                          {retryingId === report.id ? (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDelete(e, report.id, report.companyName || report.ico || identifier)}
                        disabled={deletingId === report.id}
                        title={t("reports.vymazat")}
                        className="transition-all duration-150 rounded-md p-0.5"
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
                        {timeAgoSafe(report.createdAt.toString())}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Confirm modal ── */}
      <ConfirmModal
        open={!!modal}
        title={modal?.type === "all" ? t("reports.vymazatVsetkyOtaznik") : t("reports.vymazatReportOtaznik")}
        subject={modal?.subject}
        message={modal?.type === "all" ? t("reports.nedaVratit") : t("reports.reportVymazany")}
        confirmLabel={t("reports.vymazat")}
        cancelLabel={t("reports.zrusit")}
        onConfirm={confirmDelete}
        onCancel={() => setModal(null)}
        loading={deletingId !== null || deletingAll}
      />
    </section>
  );
}
