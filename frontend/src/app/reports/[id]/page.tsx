"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import RegistryGrid from "@/components/RegistryGrid";
import CopyableText from "@/components/CopyableText";
import { useT, useLang } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import toast from "react-hot-toast";

interface ReportSource {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
}

interface Report {
  id: string;
  status: string;
  targetType: string;
  ico?: string | null;
  companyName?: string | null;
  name?: string | null;
  surname?: string | null;
  birthDate?: string | null;
  selectedSources?: string[];
  createdAt: string;
  completedAt?: string | null;
  resultUrl?: string | null;
  sources: ReportSource[];
}

const TERMINAL_STATUSES = ["COMPLETED", "FAILED"];
const POLL_INTERVAL_MS = 3000;

function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(iso));
}

// ── Skeleton Loader ──────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div className="flex gap-4 p-4 items-center">
      <div className="w-10 h-10 rounded-lg" style={{ background: "var(--bg-muted)" }} />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded" style={{ background: "var(--bg-muted)" }} />
        <div className="h-3 w-1/4 rounded" style={{ background: "var(--border)" }} />
      </div>
    </div>
  );
}

// ── Progress Timeline ────────────────────────────────────────────
function ProgressTimeline({ status, sources }: { status: string; sources: ReportSource[] }) {
  const t = useT();
  const steps = [
    { key: "PENDING", label: t("report.prijaty") },
    { key: "PROCESSING", label: t("report.spracovanie") },
    { key: "COMPLETED", label: t("report.hotovo") },
  ];
  const statusOrder: Record<string, number> = {
    PENDING: 0,
    PROCESSING: 1,
    COMPLETED: 2,
    PARTIAL: 2,
    FAILED: 2,
  };
  const current = statusOrder[status] ?? 0;

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-0">
        {steps.map((step, i) => {
          const done = current > i || (status === "COMPLETED" && i === steps.length - 1);
          const active = current === i && status !== "COMPLETED";
          const isFailed = status === "FAILED" && i === 2;
          const isPartial = status === "PARTIAL" && i === 2;

          let bg = "var(--bg-muted)";
          let color = "var(--text-muted)";
          let border = "var(--border)";

          if (isFailed) { bg = "var(--danger-bg)"; color = "var(--danger)"; border = "var(--danger)"; }
          else if (isPartial) { bg = "var(--warning-bg)"; color = "var(--warning)"; border = "var(--warning)"; }
          else if (done) { bg = "var(--success-bg)"; color = "var(--success)"; border = "var(--success)"; }
          else if (active) { bg = "var(--info-bg)"; color = "var(--info)"; border = "var(--info)"; }

          return (
            <div key={step.key} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${active ? "animate-pulse" : ""}`}
                  style={{ background: bg, color, border: `1px solid ${border}` }}
                >
                  {done && !isFailed ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active && !isFailed ? (
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : isFailed ? "✗" : isPartial ? "~" : i + 1}
                </div>
                <span
                  className="text-[10px] mt-1.5 font-medium absolute translate-y-9 whitespace-nowrap"
                  style={{ color: isFailed || isPartial || done || active ? "var(--text)" : "var(--text-muted)" }}
                >
                  {isFailed ? t("report.zlyhalo") : isPartial ? t("report.ciastocne") : step.label}
                </span>
              </div>

              {i < steps.length - 1 && (
                <div
                  className="h-[2px] w-10 sm:w-16 sm:w-28 mx-1 transition-all duration-700"
                  style={{ background: current > i ? "var(--accent)" : "var(--border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ── Error Details (expandable) ───────────────────────────────────
function ErrorDetails({ sources }: { sources: ReportSource[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const failedSources = sources.filter(s => s.status === "FAILED" || s.status === "UNAVAILABLE");

  return (
    <div className="mt-4 rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full px-4 py-3 text-left transition-colors hover:bg-opacity-50"
        style={{ background: "var(--danger-bg)" }}
      >
        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--danger-text)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
          {failedSources.length} {t("report.zdrojeZlyhali")}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="transition-transform"
          style={{ color: "var(--danger-text)", transform: expanded ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-2 fade-in">
          {failedSources.map(s => (
            <div key={s.sourceType} className="flex flex-col gap-0.5 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{s.sourceType}</span>
              {s.statusMessage && (
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.statusMessage}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${params.id}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) setError(t("report.nenajdeny"));
        else if (res.status === 403) setError(t("report.nemaPristup"));
        else setError(t("report.chybaNacitania"));
        return;
      }
      const data = await res.json();
      setReport(data);
    } catch {
      setError(t("report.sietovaChyba"));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const isFinished = report ? TERMINAL_STATUSES.includes(report.status) : false;

  // Polling for updates
  useEffect(() => {
    if (!report || isFinished) return;
    const timer = setInterval(fetchReport, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [report, isFinished, fetchReport]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/reports/${params.id}/download`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const namePart = report?.companyName || report?.ico || report?.id.slice(0, 8);
      a.download = `Verifa - ${namePart}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("report.stiahnutDokument"));
    } finally {
      setDownloading(false);
    }
  };

  const handleRetry = async () => {
    if (!report) return;
    setRetrying(true);
    try {
      const body: Record<string, unknown> = {
        targetType: report.targetType,
        sources: report.selectedSources ?? report.sources.map(s => s.sourceType),
      };
      if (report.targetType === "COMPANY") {
        body.ico = report.ico;
      } else {
        body.name = report.name;
        body.surname = report.surname;
        body.birthDate = report.birthDate;
      }
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/reports/${data.reportRequestId}`);
      }
    } catch {
      toast.error(t("history.chybaZopakovania"));
    } finally {
      setRetrying(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-8">
        <div className="card p-6 animate-pulse">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 py-12">
        <div className="card p-8 text-center border-red-500/20 bg-red-500/5">
          <div className="text-3xl mb-3">⚠️</div>
          <div className="text-sm font-medium text-red-500 mb-5">{error}</div>
          <Link href="/" className="btn-primary" style={{ background: "var(--surface)", color: "var(--text)" }}>← {t("report.spatOverenie")}</Link>
        </div>
      </div>
    );
  }

  const identifier =
    report.targetType === "COMPANY"
      ? `${t("common.ico")} ${report.ico}`
      : `${report.name} ${report.surname}`;

  const canDownload = report.status === "COMPLETED" || report.status === "PARTIAL";
  const canRetry = report.status === "FAILED" || report.status === "PARTIAL";

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 animate-fade-in" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── TOP SECTION: Report header (fixed height, same as home page) ── */}
      <section
        className="flex flex-col items-center justify-center px-2 pt-6 pb-5"
        style={{
          borderBottom: "1px solid var(--border)",
          minHeight: "180px",
        }}
      >
        {/* Breadcrumb + Nové hľadanie */}
        <div className="flex items-center justify-between w-full mb-3">
          <div className="flex items-center gap-2 text-xs">
            <Link href="/" className="transition-colors" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {t("report.overenieSubjektu")}
            </Link>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{params.id.slice(0, 8)}…</span>
          </div>
          <Link
            id="new-search-btn"
            href="/"
            className="flex items-center justify-center gap-2 transition-all hover:brightness-110 active:brightness-95 rounded-lg border text-center"
            style={{
              background: "var(--surface)",
              color: "var(--text-secondary)",
              height: "36px",
              padding: "0 14px",
              fontSize: "12.5px",
              fontWeight: 600,
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-sm)",
              textDecoration: "none"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.background = "var(--surface-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.background = "var(--surface)";
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            {t("report.noveHladanie")}
          </Link>
        </div>

        {/* Subject info — centered */}
        <div className="flex flex-col items-center text-center gap-1.5">
          <span className="text-2xl">{report.targetType === "COMPANY" ? "🏢" : "👤"}</span>

          {report.targetType === "COMPANY" && report.companyName && (
            <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
              {report.companyName}
            </h1>
          )}

          <div className={report.companyName ? "text-base font-medium" : "text-xl font-bold tracking-tight"} style={{ color: report.companyName ? "var(--text-secondary)" : "var(--text)", letterSpacing: report.companyName ? undefined : "-0.02em" }}>
            {report.targetType === "COMPANY" ? (
              <CopyableText text={report.ico ?? ""} label={t("common.ico")} />
            ) : (
              identifier
            )}
          </div>

          {report.targetType === "PERSON" && report.birthDate && (
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("report.nar")}: {new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(report.birthDate))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>{formatDate(report.createdAt, locale)}</span>
            {report.completedAt && (
              <>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span>{formatDate(report.completedAt, locale)}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("report.stav")}</span>
              <StatusBadge status={report.status} />
            </div>
            {canRetry && (
              <button
                id="retry-btn"
                onClick={handleRetry}
                disabled={retrying}
                className="flex items-center justify-center gap-2 transition-all hover:brightness-110 active:brightness-95 rounded-lg"
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  height: "36px",
                  padding: "0 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  border: "1px solid #2563eb",
                }}
              >
                {retrying ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {t("report.odosielam")}
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M9 2a7 7 0 100 14A7 7 0 009 2zM21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    {t("report.znovuOverit")}
                  </>
                )}
              </button>
            )}
            {canDownload && (
              <button
                id="download-pdf-btn"
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center justify-center gap-2 transition-all hover:brightness-110 active:brightness-95 rounded-lg"
                style={{
                  background: "var(--accent)",
                  color: "#000000",
                  height: "36px",
                  padding: "0 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  border: "1px solid var(--accent)",
                }}
              >
                {downloading ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {t("report.stahujem")}
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("report.stiahnutDokument")}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── BOTTOM SECTION: Registry grid (same as home page) ── */}
      <section className="px-2 pt-5 pb-8">
        {report.sources.length === 0 ? (
          <div className="card p-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {t("report.zdrojePripravuju")}
          </div>
        ) : (
          <>
            <RegistryGrid mode="status" sources={report.sources} />
            {report.sources.some(s => s.status === "FAILED" || s.status === "UNAVAILABLE") && (
              <ErrorDetails sources={report.sources} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
