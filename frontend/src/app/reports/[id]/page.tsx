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
import { MANUAL_LOOKUP_URLS } from "@/lib/sources";
import toast from "react-hot-toast";
import ProgressTimeline from "@/components/report/ProgressTimeline";
import ErrorDetails from "@/components/report/ErrorDetails";
import PhaseProgress from "@/components/report/PhaseProgress";
import SkeletonRow from "@/components/report/SkeletonRow";
import {
  TERMINAL_STATUSES,
  POLL_INTERVAL_MS,
  formatDate,
  type Report,
  type ReportSource,
} from "@/lib/reportConstants";

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
  const [downloadError, setDownloadError] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState(15);
  const [etaCountdown, setEtaCountdown] = useState<number | null>(null);
  const etaRef = useRef<number | null>(null);

  const fetchReport = useCallback(async () => {
    // Retry na transient network errors (Next.js streaming bug, connection reset, etc.)
    // Ak zlyhá aj po 3 pokusoch, zobrazí "Sieťová chyba" — ale normálne 2. pokus uspeje.
    const _MAX_RETRIES = 3;
    const _RETRY_DELAY_MS = 1500;
    try {
      for (let attempt = 1; attempt <= _MAX_RETRIES; attempt++) {
        try {
          const res = await fetch(`/api/reports/${params.id}`, { cache: "no-store" });
          if (!res.ok) {
            if (res.status === 401) {
              // Session expirovala → redirect na login s návratom
              router.replace(`/login?callbackUrl=/reports/${params.id}`);
              return;
            }
            if (res.status === 404) { setError(t("report.nenajdeny")); return; }
            if (res.status === 403) { setError(t("report.nemaPristup")); return; }
            // 5xx — retry, môže byť transient
            if (res.status >= 500 && attempt < _MAX_RETRIES) {
              await new Promise(r => setTimeout(r, _RETRY_DELAY_MS));
              continue;
            }
            setError(t("report.chybaNacitania"));
            return;
          }
          const data = await res.json();
          setReport(data);
          setError(null); // vyčist chybu ak predtým bola
          return;
        } catch {
          // Network-level error (fetch throw) — retry s delay
          if (attempt < _MAX_RETRIES) {
            await new Promise(r => setTimeout(r, _RETRY_DELAY_MS));
            continue;
          }
          setError(t("report.sietovaChyba"));
        }
      }
    } finally {
      // MUSÍ byť v finally — inak return v try preskočí setLoading(false)
      // a stránka ostane v loading state navždy (skeleton = "prázdna stránka")
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
      if (etaRef.current === null || Math.abs(report.eta - etaRef.current) > 5) {
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

  // Cancel countdown timer — iba ak je report mladší než 15s
  useEffect(() => {
    if (isFinished || cancelling || !report?.createdAt) return;
    const ageSec = (Date.now() - new Date(report.createdAt).getTime()) / 1000;
    if (ageSec >= 15) {
      setCancelCountdown(0);
      return;
    }
    // Nastav countdown na zostávajúci čas
    setCancelCountdown(Math.max(0, Math.ceil(15 - ageSec)));
    const timer = setInterval(() => {
      setCancelCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isFinished, cancelling, report?.createdAt]);

  const handleCancel = async () => {
    if (!report) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/reports/${params.id}/cancel`, { method: "POST" });
      if (res.ok) {
        toast.success(t("report.zruseny"));
        await fetchReport();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("report.stornoChyba"));
      }
    } catch {
      toast.error(t("report.stornoChyba"));
    } finally {
      setCancelling(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      const namePart = report?.companyName || report?.ico || report?.id.slice(0, 8);
      const filename = `Verifa - ${namePart}.pdf`.replace(/\s+/g, "_");
      // Use fetch + blob instead of window.location.href so we can catch
      // network errors and show a retry button. The download endpoint returns
      // a 302 redirect to a presigned S3 URL — fetch follows it automatically.
      const res = await fetch(`/api/reports/${params.id}/download?filename=${encodeURIComponent(filename)}`, {
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(true);
      toast.error(t("report.stiahnutDokument"));
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloadingCsv(true);
    try {
      const res = await fetch(`/api/reports/${params.id}/export-csv`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const namePart = report?.companyName || report?.ico || report?.id.slice(0, 8);
      a.download = `Verifa - ${namePart} - financials.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("report.csvChyba"));
    } finally {
      setDownloadingCsv(false);
    }
  };

  const handleShareEmail = async () => {
    setSharing(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(`/api/reports/${params.id}/download`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const namePart = report?.companyName || report?.ico || report?.id.slice(0, 8);
      const fileName = `Verifa_${namePart}.pdf`.replace(/\s+/g, '_');
      const file = new File([blob], fileName, { type: "application/pdf" });
      
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Verifa Report - ${namePart}`,
          text: t("report.zdielanieText", { name: namePart ?? "" }),
          files: [file]
        });
      } else {
        toast.error(t("report.zdielanieNepodporovane"));
        handleDownload();
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        toast.error(t("report.zdielanieChyba"));
      }
    } finally {
      setSharing(false);
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
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || t("history.chybaZopakovania"));
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
  // Storno iba krátko po vytvorení (15s okno), aby užívateľ mohol zrušiť
  // predtým než sa začnú míňať tokeny na agentov. Nie pri otvorení starého reportu.
  const reportAgeSec = report.createdAt ? (Date.now() - new Date(report.createdAt).getTime()) / 1000 : Infinity;
  const canCancel = !isFinished && cancelCountdown > 0 && report.status !== "CANCELLED" && reportAgeSec < 15;

  const score = report.verifaScore ?? 100;
  const scoreColor = score < 50 ? "var(--danger)" : score < 80 ? "var(--warning)" : "var(--success)";
  const scoreBgColor = score < 50 ? "var(--danger-bg)" : score < 80 ? "var(--warning-bg)" : "var(--success-bg)";

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 animate-fade-in" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── TOP SECTION: Report header ── */}
      <section
        className="flex flex-col items-center justify-center px-2 pt-6 pb-5"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center justify-between w-full mb-3">
          <div className="flex items-center gap-2 text-xs">
            <Link href="/dashboard" className="transition-colors" style={{ color: "var(--text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}>
              {t("report.overenieSubjektu")}
            </Link>
            <span style={{ color: "var(--border-strong)" }}>/</span>
            <span className="font-mono hidden sm:inline" style={{ color: "var(--text-secondary)" }}>{params.id.slice(0, 8)}…</span>
          </div>
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

          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
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
            {canCancel && (
              <button
                id="cancel-btn"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center justify-center gap-2 transition-all hover:brightness-110 active:brightness-95 rounded-lg"
                style={{
                  background: "transparent",
                  color: "var(--danger)",
                  height: "36px",
                  padding: "0 14px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  border: "1px solid var(--danger)",
                }}
              >
                {cancelling ? (
                  <>
                    <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {t("report.storujem")}
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    {t("report.storno")} ({cancelCountdown}s)
                  </>
                )}
              </button>
            )}
            {canRetryFailed && (
              <div className="text-[10px] text-purple-400 mt-1">
                {t("report.kreditNeodpocital")}
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
            {downloadError && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-rose-400">{t("report.stiahnutDokument")}</span>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="text-[11px] text-amber-400 hover:text-amber-300 underline disabled:opacity-50"
                >
                  ↻ {t("report.skusitZnova") || "Skúsiť znova"}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── BOTTOM SECTION: Registry grid (same as home page) ── */}
      <section className="px-2 pt-5 pb-8">
        {report.status === "PENDING" ? (
          <div className="max-w-2xl mx-auto fade-in">
            <div className="rounded-2xl p-5 shadow-sm flex items-center gap-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "var(--warning-bg)" }}>
                <svg className="w-5 h-5 animate-pulse" style={{ color: "var(--warning)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("report.queuedTitle")}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{t("report.queuedMessage")}</p>
              </div>
            </div>
          </div>
        ) : report.sources.length === 0 ? (
          <div className="card p-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
            {t("report.zdrojePripravuju")}
          </div>
        ) : !isFinished ? (
          <>
            <PhaseProgress
              sourcesCompleted={report.sources.filter(s => ["SUCCESS","FAILED","UNAVAILABLE"].includes(s.status)).length}
              sourcesTotal={report.sources.length}
              aiStatus={report.aiStatus}
              reportStatus={report.status}
              etaCountdown={etaCountdown}
              locale={locale}
              startedAt={new Date(report.createdAt).getTime()}
              serverUpdatedAt={report.updatedAt}
            />
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
                      <span className="font-bold text-[14px]" style={{ color: "var(--success)" }}>{t("report.stahujemReport")}</span>
                    </div>
                  )}

                  {/* Inner content resembling the PDF cover page */}
                  <div className="w-full h-full p-4 flex flex-col items-center text-center relative z-0 bg-white">
                    <div className="mb-4 opacity-90 transform scale-75"><Logo size="md" /></div>
                    
                    <div className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
                      Business Risk Report
                    </div>
                    
                    <div className="text-[15px] font-black text-slate-800 leading-tight mb-4">
                      {report.companyName || identifier}
                    </div>
                    
                    {/* Mock Stamp */}
                    <div className="mt-auto mb-auto relative w-24 h-24 shrink-0 flex items-center justify-center transform rotate-[-8deg] opacity-90">
                      <div className="absolute inset-0 rounded-full border-[2.5px] border-dashed opacity-60" style={{ borderColor: scoreColor }} />
                      <div className="absolute inset-[4px] rounded-full border-[1.5px] opacity-90" style={{ borderColor: scoreColor, background: scoreBgColor }} />
                      <div className="absolute inset-[12px] rounded-full border border-dashed opacity-40" style={{ borderColor: scoreColor }} />
                      
                      <div className="font-black text-[8px] tracking-widest absolute top-[18px]" style={{ color: scoreColor }}>★ VERIFA ★</div>
                      <div className="font-black text-2xl mt-1" style={{ color: scoreColor }}>
                        {score}
                      </div>
                      <div className="w-8 h-[2px] absolute bottom-7 opacity-50" style={{ background: scoreColor }} />
                      <div className="font-bold text-[7px] tracking-widest absolute bottom-[16px]" style={{ color: scoreColor }}>SKÓRE</div>
                    </div>

                    {/* Mock Footer Area */}
                    <div className="w-full mt-auto">
                      <div className="flex justify-between items-end mb-4">
                        <div className="space-y-1.5">
                          <div className="w-12 h-[3px] bg-slate-200 rounded-full"></div>
                          <div className="w-16 h-[3px] bg-slate-200 rounded-full"></div>
                          <div className="w-10 h-[3px] bg-slate-200 rounded-full"></div>
                        </div>
                        <div className="w-14 h-4 rounded-sm flex items-center px-1 gap-1" style={{ background: "var(--success-bg)", border: "1px solid var(--success-border, var(--success))" }}>
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--success)" }}></div>
                          <div className="w-6 h-1.5 rounded-full" style={{ background: "var(--success-bg)", border: "1px solid var(--success)" }}></div>
                        </div>
                      </div>
                      <div className="w-full border-t border-slate-200 pt-3">
                        <div className="w-24 h-[2px] bg-slate-200 rounded-full mx-auto mb-1.5"></div>
                        <div className="w-32 h-[2px] bg-slate-200 rounded-full mx-auto"></div>
                      </div>
                    </div>
                  </div>

                  {/* Download overlay — always visible on mobile (touch), hover on desktop */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-[1.5px] transition-all duration-300 z-10 sm:opacity-0 sm:group-hover:opacity-100" style={{ background: "color-mix(in srgb, var(--success) 8%, transparent)" }}>
                    <div className="p-4 rounded-full mb-3 shadow-xl sm:transform sm:translate-y-3 sm:group-hover:translate-y-0 transition-all duration-300" style={{ background: "var(--success)", color: "#fff" }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="font-bold px-5 py-2 rounded-full text-[13px] shadow-md sm:transform sm:translate-y-3 sm:group-hover:translate-y-0 transition-all duration-300 sm:delay-75" style={{ background: "var(--surface)", color: "var(--success)" }}>
                      {t("report.stiahnutPdf")}
                    </div>
                  </div>
                </button>

                {/* Download label */}
                <p className="text-[15px] font-bold text-center mb-3" style={{ color: "var(--text)" }}>
                  {t("report.stiahnutReport")}
                </p>

                {/* Download buttons row */}
                <div className="flex gap-2 w-full max-w-[340px] mb-2">
                  <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-[13px] transition-all hover:brightness-110 active:brightness-95"
                    style={{
                      background: "var(--success)",
                      color: "#ffffff",
                      boxShadow: "0 4px 12px -3px color-mix(in srgb, var(--success) 40%, transparent)",
                    }}
                  >
                    {downloading ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 10v6M9 13l3 3 3-3M5 20h14a2 2 0 002-2V8l-6-6H5a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    )}
                    PDF
                  </button>
                  <button
                    onClick={handleDownloadCsv}
                    disabled={downloadingCsv}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-[13px] transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
                    style={{
                      border: "1px solid var(--border)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {downloadingCsv ? (
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="8" y1="13" x2="16" y2="13" />
                        <line x1="8" y1="17" x2="16" y2="17" />
                      </svg>
                    )}
                    CSV
                  </button>
                </div>

                <h2 className="text-xl font-bold mb-2 flex items-center gap-2 mt-4" style={{ color: "var(--success)" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                  {t("report.analyzaUspesna")}
                </h2>
                <p className="text-[13.5px] text-center max-w-[280px]" style={{ color: "var(--text-muted)" }}>
                  {t("report.analyzaUspesnaPopis")}
                </p>

                <button
                  onClick={handleShareEmail}
                  disabled={sharing}
                  className="mt-5 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-medium text-[13px] transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                  {t("report.poslatEmailom")}
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
                  {t("report.analyzaZlyhala")}
                </h2>
                <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
                  {t("report.analyzaZlyhalaPopis")}
                </p>
              </>
            )}

            {/* Stats row */}
            <div className="flex gap-4 mb-7 flex-wrap justify-center">
              {[
                {
                  value: report.sources.filter(s => s.status === "SUCCESS").length,
                  label: t("report.zdrojovOverenych"),
                  color: "var(--success)",
                  bg: "var(--success-bg)",
                },
                {
                  value: report.sources.filter(s => s.status === "FAILED" || s.status === "UNAVAILABLE").length,
                  label: t("report.nedostupnychZdrojov"),
                  color: "var(--warning)",
                  bg: "var(--warning-bg)",
                },
                {
                  value: report.sources.reduce((acc, s) => acc + (s.pageCount ?? 0), 0),
                  label: t("report.stranDokumentacie"),
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
                {retrying ? t("report.odosielam") : t("report.zopakovatOverenie")}
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
