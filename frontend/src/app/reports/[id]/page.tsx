"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import RegistryGrid from "@/components/RegistryGrid";
import CopyableText from "@/components/CopyableText";
import Logo from "@/components/Logo";
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
  aiStatus?: string | null;
  eta?: number | null;
  verifaScore?: number;
  sources: ReportSource[];
}

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL"];
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

  if (failedSources.length === 0) return null;

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

// ── AI Magic Loader ──────────────────────────────────────────
const LOADER_STEPS = [
  "report.step1",
  "report.step2",
  "report.step3",
  "report.step4",
  "report.step5",
  "report.step6",
  "report.step7",
  "report.step8",
  "report.step9",
];

function MagicLoader({ sourcesCompleted, sourcesTotal }: { sourcesCompleted: number, sourcesTotal: number }) {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(prev => {
        if (prev < 7) return prev + 1;
        const allDone = sourcesTotal > 0 && sourcesCompleted >= sourcesTotal;
        if (allDone && prev < LOADER_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 1800);
    return () => clearInterval(interval);
  }, [sourcesCompleted, sourcesTotal]);

  const currentText = t(LOADER_STEPS[Math.min(activeStep, LOADER_STEPS.length - 1)]);

  return (
    <div className="mt-8 rounded-2xl p-5 w-full max-w-2xl mx-auto shadow-sm relative fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-4">
        {/* Animated Icon */}
        <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center relative" style={{ background: "var(--success-bg)" }}>
          <svg className="w-5 h-5 animate-spin relative z-10" style={{ color: "var(--success)" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <div className="absolute inset-0 rounded-full opacity-20 animate-ping" style={{ background: "var(--success)" }}></div>
        </div>
        
        {/* Current Status */}
        <div className="flex-1 min-w-0">
          <h3 className="text-[11px] font-bold tracking-wider uppercase mb-1" style={{ color: "var(--text-muted)" }}>
            {t("report.processing")}
          </h3>
          <div className="flex items-center gap-2">
            <span className="shrink-0 tabular-nums text-sm font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
              [{new Date().toLocaleTimeString(locale, {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]
            </span>
            <span className="text-[15px] font-medium truncate" style={{ color: "var(--success)" }}>
              {currentText}
            </span>
            <span className="flex gap-1 items-center ml-1 opacity-70">
              <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "var(--success)", animationDelay: "0ms" }}></span>
              <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "var(--success)", animationDelay: "150ms" }}></span>
              <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "var(--success)", animationDelay: "300ms" }}></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Aggregate Progress ───────────────────────────────────────────
function AggregateProgress({ sources }: { sources: ReportSource[] }) {
  const t = useT();
  const completed = sources.filter((s) => ["SUCCESS", "FAILED", "UNAVAILABLE"].includes(s.status)).length;
  const total = sources.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="mt-6 flex flex-col items-center max-w-2xl mx-auto w-full px-2 fade-in">
      <div className="w-full flex justify-between text-sm font-semibold text-[var(--text)] mb-2 px-1">
        <span>{t("report.registersProgress")}</span>
        <span>{completed} / {total}</span>
      </div>
      <div className="w-full h-2 bg-[var(--border)] rounded-full overflow-hidden">
         <div className="h-full bg-[var(--success)] transition-all duration-500 ease-out" style={{ width: `${percentage}%` }} />
      </div>
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
  const [etaCountdown, setEtaCountdown] = useState<number | null>(null);
  const etaRef = useRef<number | null>(null);

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

  // Sync ETA from server when it changes
  useEffect(() => {
    if (report?.eta != null && report.eta > 0 && !isFinished) {
      if (etaRef.current === null || Math.abs(report.eta - etaRef.current) > 10) {
        etaRef.current = report.eta;
        setEtaCountdown(report.eta);
      }
    }
  }, [report?.eta, isFinished]);

  // Client-side countdown timer
  useEffect(() => {
    if (etaCountdown === null || etaCountdown <= 0 || isFinished) return;
    const timer = setInterval(() => {
      setEtaCountdown(prev => prev !== null ? Math.max(0, prev - 1) : null);
    }, 1000);
    return () => clearInterval(timer);
  }, [etaCountdown, isFinished]);

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

  const handleShareEmail = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/reports/${params.id}/download`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const namePart = report?.companyName || report?.ico || report?.id.slice(0, 8);
      const fileName = `Verifa_${namePart}.pdf`.replace(/\\s+/g, '_');
      const file = new File([blob], fileName, { type: "application/pdf" });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Forenzný Report - ${namePart}`,
          text: `Dobrý deň,\\n\\nv prílohe posielam preverený forenzný report pre subjekt ${namePart}.`,
          files: [file]
        });
      } else {
        toast.error("Tento prehliadač nepodporuje priame zdieľanie súborov. Dokument sa klasicky stiahne.");
        handleDownload();
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        toast.error("Zdieľanie zlyhalo.");
      }
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
  const canRetryFailed = report.status === "FAILED";
  const canRetryPartial = report.status === "PARTIAL";
  const canRetry = canRetryFailed || canRetryPartial;

  const score = report.verifaScore ?? 100;
  let scoreColorText = "text-emerald-600";
  let scoreColorBorder = "border-emerald-500";
  let scoreBg = "bg-emerald-500";
  
  if (score < 50) {
    scoreColorText = "text-red-600";
    scoreColorBorder = "border-red-500";
    scoreBg = "bg-red-500";
  } else if (score < 80) {
    scoreColorText = "text-amber-500";
    scoreColorBorder = "border-amber-500";
    scoreBg = "bg-amber-500";
  }

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
            <Link href="/dashboard" className="transition-colors" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {t("report.overenieSubjektu")}
            </Link>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{params.id.slice(0, 8)}…</span>
          </div>
          <Link
            id="new-search-btn"
            href="/dashboard"
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
                  background: canRetryFailed ? "#8b5cf6" : "#2563eb",
                  color: "#ffffff",
                  height: "36px",
                  padding: "0 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  border: canRetryFailed ? "1px solid #8b5cf6" : "1px solid #2563eb",
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
            {canRetryFailed && (
              <div className="text-[10px] text-purple-400 mt-1">
                Kredit neodpočítal
              </div>
            )}
            {canDownload && !isFinished && (
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
        ) : !isFinished ? (
          <>
            <MagicLoader
              sourcesCompleted={report.sources.filter(s => ["SUCCESS","FAILED","UNAVAILABLE"].includes(s.status)).length}
              sourcesTotal={report.sources.length}
            />
            <AggregateProgress sources={report.sources} />
            {etaCountdown != null && etaCountdown > 0 && (
              <div className="text-center mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                {(() => {
                  const s = etaCountdown;
                  if (s < 60) return t("report.etaSeconds", { s });
                  const m = Math.floor(s / 60);
                  const r = s % 60;
                  return t("report.etaMinutes", { m, r: r > 0 ? r : "" }).replace("  s", "");
                })()}
              </div>
            )}
            {report.aiStatus && (
              <div className="text-center mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {t(report.aiStatus)}
              </div>
            )}
            {report.sources.some(s => s.status === "FAILED" || s.status === "UNAVAILABLE") && (
              <div className="max-w-2xl mx-auto mt-4 w-full">
                 <ErrorDetails sources={report.sources} />
              </div>
            )}
          </>
        ) : (
          <div className="fade-in flex flex-col items-center justify-center pt-4 pb-16 px-4">

            {/* PDF Preview Success Card */}
            {canDownload ? (
              <div className="flex flex-col items-center justify-center mb-8 w-full transition-all fade-in">
                
                {/* PDF Preview Button */}
                <button
                  id="download-pdf-btn-completion"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="group relative flex flex-col items-center bg-white rounded-xl overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98] w-full max-w-[220px] aspect-[1/1.414] mb-7"
                  style={{
                    border: "2px solid var(--success)",
                    boxShadow: "0 12px 32px -8px color-mix(in srgb, var(--success) 35%, transparent), 0 2px 8px -1px color-mix(in srgb, var(--success) 15%, transparent)",
                  }}
                >
                  {downloading && (
                    <div className="absolute inset-0 bg-white/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4 z-20">
                      <svg className="animate-spin w-10 h-10 text-[var(--success)]" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      <span className="font-bold text-[14px]" style={{ color: "var(--success)" }}>Sťahujem report…</span>
                    </div>
                  )}

                  {/* Inner content resembling the PDF cover page */}
                  <div className="w-full h-full p-4 flex flex-col items-center text-center relative z-0 bg-white">
                    <div className="mb-4 opacity-90 transform scale-75"><Logo size="md" /></div>
                    
                    <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                      Forenzný Due Diligence Report
                    </div>
                    
                    <div className="text-[15px] font-black text-slate-800 leading-tight mb-4">
                      {report.companyName || identifier}
                    </div>
                    
                    {/* Mock Stamp */}
                    <div className="mt-auto mb-auto relative w-24 h-24 shrink-0 flex items-center justify-center transform rotate-[-8deg] opacity-80">
                      <div className={`absolute inset-0 rounded-full border-[2.5px] ${scoreColorBorder} border-dashed opacity-60`} />
                      <div className={`absolute inset-[4px] rounded-full border-[1.5px] ${scoreColorBorder} opacity-90`} />
                      <div className={`absolute inset-[12px] rounded-full border ${scoreColorBorder} border-dashed opacity-40`} />
                      
                      <div className={`${scoreColorText} font-black text-[8px] tracking-widest absolute top-[18px]`}>★ VERIFA ★</div>
                      <div className={`${scoreColorText} font-black text-2xl mt-1`}>
                        {score}
                      </div>
                      <div className={`w-8 h-[2px] ${scoreBg} absolute bottom-7 opacity-50`} />
                      <div className={`${scoreColorText} font-bold text-[7px] tracking-widest absolute bottom-[16px]`}>SKÓRE</div>
                    </div>

                    {/* Mock Footer Area */}
                    <div className="w-full mt-auto">
                      <div className="flex justify-between items-end mb-4">
                        <div className="space-y-1.5">
                          <div className="w-12 h-[3px] bg-slate-200 rounded-full"></div>
                          <div className="w-16 h-[3px] bg-slate-200 rounded-full"></div>
                          <div className="w-10 h-[3px] bg-slate-200 rounded-full"></div>
                        </div>
                        <div className="w-14 h-4 bg-emerald-50 border border-emerald-200 rounded-sm flex items-center px-1 gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                          <div className="w-6 h-1.5 bg-emerald-200 rounded-full"></div>
                        </div>
                      </div>
                      <div className="w-full border-t border-slate-200 pt-3">
                        <div className="w-24 h-[2px] bg-slate-200 rounded-full mx-auto mb-1.5"></div>
                        <div className="w-32 h-[2px] bg-slate-200 rounded-full mx-auto"></div>
                      </div>
                    </div>
                  </div>

                  {/* Overlay Success message and Download Icon on Hover */}
                  <div className="absolute inset-0 bg-emerald-900/5 flex flex-col items-center justify-center backdrop-blur-[1.5px] opacity-0 group-hover:opacity-100 transition-all duration-300 z-10">
                    <div className="bg-emerald-500 text-white p-4 rounded-full mb-3 shadow-xl transform translate-y-3 group-hover:translate-y-0 transition-all duration-300">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="font-bold text-emerald-700 bg-white px-5 py-2 rounded-full text-[13px] shadow-md transform translate-y-3 group-hover:translate-y-0 transition-all duration-300 delay-75">
                      Stiahnuť PDF report
                    </div>
                  </div>
                </button>

                {/* Always-visible green CTA bar */}
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="flex items-center justify-center gap-3 w-full max-w-[340px] px-6 py-4 rounded-xl font-bold text-[15px] transition-all hover:brightness-110 active:brightness-95 mb-2"
                  style={{
                    background: "var(--success)",
                    color: "#ffffff",
                    boxShadow: "0 8px 24px -6px color-mix(in srgb, var(--success) 40%, transparent)",
                  }}
                >
                  {downloading ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Sťahujem report…
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Stiahnuť PDF report
                    </>
                  )}
                </button>

                <h2 className="text-xl font-bold mb-2 flex items-center gap-2 mt-4" style={{ color: "var(--success)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  Analýza úspešne dokončená
                </h2>
                <p className="text-[13.5px] text-center max-w-[280px]" style={{ color: "var(--text-muted)" }}>
                  Všetky štátne registre boli preverené a forenzný posudok je pripravený.
                </p>

                <button
                  onClick={handleShareEmail}
                  className="mt-5 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-medium text-[13px] transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  Poslať e-mailom (s PDF v prílohe)
                </button>
              </div>
            ) : (
              <>
                <div
                  className="flex items-center justify-center rounded-full mb-5"
                  style={{
                    width: 72, height: 72,
                    background: "var(--danger-bg)",
                    border: "2px solid var(--danger)",
                  }}
                >
                  <span className="text-3xl">⚠️</span>
                </div>
                <h2 className="text-xl font-bold mb-1" style={{ color: "var(--text)" }}>
                  Analýza zlyhala
                </h2>
                <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
                  Report nebolo možné vygenerovať.
                </p>
              </>
            )}

            {/* Stats row */}
            <div className="flex gap-4 mb-7 flex-wrap justify-center">
              {[
                {
                  value: report.sources.filter(s => s.status === "SUCCESS").length,
                  label: "Zdrojov overených",
                  color: "var(--success)",
                  bg: "var(--success-bg)",
                },
                {
                  value: report.sources.filter(s => s.status === "FAILED" || s.status === "UNAVAILABLE").length,
                  label: "Nedostupných zdrojov",
                  color: "var(--warning)",
                  bg: "var(--warning-bg)",
                },
                {
                  value: report.sources.reduce((acc, s) => acc + (s.pageCount ?? 0), 0),
                  label: "Strán dokumentácie",
                  color: "var(--info)",
                  bg: "var(--info-bg)",
                },
              ].map(({ value, label, color, bg }) => (
                <div
                  key={label}
                  className="flex flex-col items-center rounded-xl px-5 py-3 min-w-[100px]"
                  style={{ background: bg, border: `1px solid ${color}22` }}
                >
                  <span className="text-2xl font-bold" style={{ color }}>{value}</span>
                  <span className="text-[11px] font-medium mt-0.5 text-center" style={{ color: "var(--text-muted)" }}>{label}</span>
                </div>
              ))}
            </div>



            {/* Retry for partial */}
            {canRetryPartial && (
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="mt-3 text-xs underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{ color: "var(--text-muted)" }}
              >
                {retrying ? "Odosielam…" : "Zopakovať overenie"}
              </button>
            )}

            {/* Expandable source details */}
            {report.sources.some(s => s.status === "FAILED" || s.status === "UNAVAILABLE") && (
              <div className="mt-6 max-w-lg w-full">
                <ErrorDetails sources={report.sources} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
