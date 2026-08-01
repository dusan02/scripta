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

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL", "CANCELLED"];
const POLL_INTERVAL_MS = 5000;

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
                  className="text-[10px] mt-1.5 font-medium whitespace-nowrap"
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
          {failedSources.map(s => {
            const url = MANUAL_LOOKUP_URLS[s.sourceType];
            return (
              <div key={s.sourceType} className="flex flex-col gap-0.5 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{s.sourceType}</span>
                {s.statusMessage && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{s.statusMessage}</span>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] inline-flex items-center gap-1 hover:underline" style={{ color: "var(--info)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t("report.manualLookup")}: {url.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Phase Progress (weighted, time-interpolated) ─────────────────
// Based on real telemetry: total ~329s, analyzing_statements alone = ~180s.
const PHASE_WEIGHTS = {
  scraping: 30,
  aiPipeline: 50,
  verdict: 12,
  compiling: 8,
} as const;

// Each AI status has a start%, end%, and estimated duration (seconds).
// Progress interpolates linearly from start→end over the estimated duration,
// so the bar moves continuously instead of jumping and freezing.
const AI_STATUS_RANGES: Record<string, { start: number; end: number; estSeconds: number }> = {
  "ai.queued":               { start: 0, end: 1, estSeconds: 10 },
  "ai.checking_registers":   { start: 0, end: 5, estSeconds: 10 },
  "ai.retrying":              { start: 0, end: 5, estSeconds: 10 },
  "ai.downloading":           { start: 5, end: 30, estSeconds: 55 },
  "ai.analyzing_statements":  { start: 30, end: 40, estSeconds: 15 },
  "ai.extracting_financials": { start: 40, end: 55, estSeconds: 120 },  // ← longest phase (IFRS chunking)
  "ai.semantic_narrative":    { start: 55, end: 65, estSeconds: 60 },
  "ai.forensic_notes":        { start: 65, end: 72, estSeconds: 30 },
  "ai.risk_analysis":         { start: 72, end: 78, estSeconds: 20 },
  "ai.final_verdict":         { start: 78, end: 82, estSeconds: 10 },
  "ai.cross_validation":      { start: 82, end: 86, estSeconds: 15 },
  "ai.forensic_analysis":     { start: 86, end: 90, estSeconds: 15 },
  "ai.cross_correlation":     { start: 90, end: 95, estSeconds: 90 },  // Chief Auditor: reálne 80-130s
  "ai.risk_synthesis":        { start: 95, end: 97, estSeconds: 15 },
  "ai.compiling":             { start: 97, end: 99, estSeconds: 30 },
};

function computeWeightedProgress(
  sourcesCompleted: number,
  sourcesTotal: number,
  aiStatus: string | null | undefined,
  reportStatus: string,
  aiStatusStartedAt: number | null
): number {
  if (["COMPLETED", "PARTIAL", "FAILED"].includes(reportStatus)) return 100;

  const scrapingProgress = sourcesTotal > 0
    ? (sourcesCompleted / sourcesTotal) * PHASE_WEIGHTS.scraping
    : 0;

  let aiProgress = 0;
  if (aiStatus && aiStatus in AI_STATUS_RANGES) {
    const range = AI_STATUS_RANGES[aiStatus];
    if (aiStatusStartedAt !== null) {
      const elapsed = (Date.now() - aiStatusStartedAt) / 1000;
      const fraction = elapsed / range.estSeconds;
      if (fraction <= 1) {
        // Ease-out curve: fast initial progress, slows near the end
        const eased = 1 - Math.pow(1 - fraction, 2);
        aiProgress = range.start + (range.end - range.start) * eased;
      } else {
        // Past estimated duration: creep asymptotically toward end,
        // never freezing at exactly end% — keeps bar moving slowly
        const overshoot = fraction - 1;
        const creep = 1 - Math.exp(-overshoot * 0.15);
        aiProgress = range.start + (range.end - range.start) * (1 - 0.5 * (1 - creep));
      }
    } else {
      aiProgress = range.start;
    }
  }

  return Math.min(99, Math.max(scrapingProgress, aiProgress));
}

function getPhaseLabel(aiStatus: string | null | undefined, t: (k: string) => string): string {
  if (!aiStatus || aiStatus === "ai.queued" || aiStatus === "ai.checking_registers" || aiStatus === "ai.retrying")
    return t("report.phaseScraping");
  if ([
    "ai.downloading", "ai.analyzing_statements", "ai.extracting_financials",
    "ai.semantic_narrative", "ai.forensic_notes", "ai.risk_analysis",
    "ai.final_verdict", "ai.cross_validation",
  ].includes(aiStatus))
    return t("report.phaseAiPipeline");
  if (["ai.forensic_analysis", "ai.cross_correlation", "ai.risk_synthesis"].includes(aiStatus))
    return t("report.phaseVerdict");
  if (aiStatus === "ai.compiling") return t("report.phaseCompiling");
  return t("report.phaseScraping");
}

interface LogEntry {
  status: string;
  text: string;
  timestamp: number;
}

function PhaseProgress({
  sourcesCompleted,
  sourcesTotal,
  aiStatus,
  reportStatus,
  etaCountdown,
  locale,
  startedAt,
}: {
  sourcesCompleted: number;
  sourcesTotal: number;
  aiStatus?: string | null;
  reportStatus: string;
  etaCountdown: number | null;
  locale: string;
  startedAt: number;
}) {
  const t = useT();
  const phaseLabel = getPhaseLabel(aiStatus, t);
  const statusText = aiStatus ? t(aiStatus) : t("report.processing");
  const isScraping = !aiStatus || aiStatus === "ai.queued" || aiStatus === "ai.checking_registers" || aiStatus === "ai.retrying";
  const isTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(reportStatus);

  // Track AI status history as a log (cap at 10 entries, show last 3)
  const [statusLog, setStatusLog] = useState<LogEntry[]>([]);
  const lastStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const currentStatus = aiStatus || "report.processing";
    if (currentStatus !== lastStatusRef.current) {
      lastStatusRef.current = currentStatus;
      const entry: LogEntry = {
        status: currentStatus,
        text: t(currentStatus),
        timestamp: Date.now(),
      };
      setStatusLog(prev => [...prev, entry].slice(-10));
    }
  }, [aiStatus, t]);

  // Track elapsed time to show patience warning
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (isTerminal) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isTerminal]);
  const showPatienceWarning = elapsedSec > 600 && !isTerminal;

  // Track when the current AI status first appeared (for time-based interpolation)
  const aiStatusRef = useRef<string | null>(null);
  const aiStatusStartedRef = useRef<number | null>(null);
  // Initialize progress from current AI status range start (avoids 0% on remount/refresh)
  const _initialProgress = (() => {
    if (isTerminal) return 100;
    if (aiStatus && aiStatus in AI_STATUS_RANGES) return AI_STATUS_RANGES[aiStatus].start;
    if (sourcesTotal > 0) return (sourcesCompleted / sourcesTotal) * PHASE_WEIGHTS.scraping;
    return 0;
  })();
  const [displayProgress, setDisplayProgress] = useState(_initialProgress);
  const displayRef = useRef(_initialProgress);
  useEffect(() => { displayRef.current = displayProgress; }, [displayProgress]);

  // Reset timer when AI status changes
  useEffect(() => {
    if (aiStatus !== aiStatusRef.current) {
      aiStatusRef.current = aiStatus ?? null;
      aiStatusStartedRef.current = Date.now();
    }
  }, [aiStatus]);

  useEffect(() => {
    if (isTerminal) {
      setDisplayProgress(100);
      return;
    }
    const interval = setInterval(() => {
      const target = computeWeightedProgress(
        sourcesCompleted, sourcesTotal, aiStatus, reportStatus, aiStatusStartedRef.current
      );
      const current = displayRef.current;
      const diff = target - current;
      if (Math.abs(diff) < 0.3) {
        setDisplayProgress(target);
        return;
      }
      // Smooth creep toward target
      const step = Math.max(0.15, diff * 0.12);
      setDisplayProgress(Math.min(target, current + step));
    }, 500);
    return () => clearInterval(interval);
  }, [sourcesCompleted, sourcesTotal, aiStatus, reportStatus, isTerminal]);

  return (
    <div className="mt-8 flex flex-col items-center max-w-2xl mx-auto w-full px-2 fade-in">
      {/* Loader card */}
      <div className="w-full rounded-2xl p-4 shadow-sm relative fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {/* Top row: icon + % — never overlaps text */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-3">
            {/* Animated Icon */}
            <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center relative" style={{ background: "var(--success-bg)" }}>
              <svg className="w-4 h-4 animate-spin relative z-10" style={{ color: "var(--success)" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <div className="absolute inset-0 rounded-full opacity-20 animate-ping" style={{ background: "var(--success)" }}></div>
            </div>
            {isScraping && sourcesTotal > 0 && (
              <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>
                {sourcesCompleted}/{sourcesTotal} {t("report.zdrojov")}
              </span>
            )}
          </div>
          {/* Percentage badge — always top-right, never wraps into text */}
          <span className="shrink-0 text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--success)" }}>
            {Math.round(displayProgress)}<span className="text-sm font-semibold">%</span>
          </span>
        </div>

        {/* Status text — full width, no competition with % */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="shrink-0 tabular-nums text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            [{new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]
          </span>
          <span className="text-[14px] font-medium leading-snug" style={{ color: "var(--success)" }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* Weighted progress bar */}
      <div className="w-full mt-4">
        <div className="w-full h-2.5 rounded-full overflow-hidden relative" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full ease-linear"
            style={{ width: `${displayProgress}%`, background: "var(--success)", transition: "width 500ms linear" }}
          />
        </div>
      </div>

      {/* Elapsed time */}
      {!isTerminal && (
        <div className="text-center mt-3 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:{String(elapsedSec % 60).padStart(2, "0")}
        </div>
      )}

      {/* Status history log — last 3 entries, no inner scroll */}
      {statusLog.length > 1 && (
        <div className="w-full mt-3 rounded-lg p-2 text-xs font-mono" style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
          {statusLog.slice(-3).map((entry, i, arr) => {
            const isLast = i === arr.length - 1;
            const time = new Date(entry.timestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return (
              <div key={entry.timestamp} className="flex items-start gap-2 py-0.5" style={{ opacity: isLast ? 1 : 0.5 }}>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>[{time}]</span>
                <span style={{ color: isLast ? "var(--success)" : "var(--text-muted)", fontWeight: isLast ? 500 : 400 }}>
                  {entry.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Patience warning after 10 min */}
      {showPatienceWarning && (
        <div className="text-center mt-3 px-4 py-2.5 rounded-lg text-xs fade-in" style={{
          background: "var(--warning-bg)",
          color: "var(--warning-text)",
          border: "1px solid var(--warning)",
        }}>
          <span className="font-semibold">⏳ {t("report.patienceTitle")}</span>
          <span className="block mt-0.5 opacity-80 whitespace-pre-line">{t("report.patienceBody")}</span>
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
  const [downloadError, setDownloadError] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState(15);
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

  // Cancel countdown timer (8 seconds window)
  useEffect(() => {
    if (isFinished || cancelling) return;
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
  }, [isFinished, cancelling]);

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
  const canCancel = !isFinished && cancelCountdown > 0 && report.status !== "CANCELLED";

  const score = report.verifaScore ?? 100;
  const scoreColor = score < 50 ? "var(--danger)" : score < 80 ? "var(--warning)" : "var(--success)";
  const scoreBgColor = score < 50 ? "var(--danger-bg)" : score < 80 ? "var(--warning-bg)" : "var(--success-bg)";

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 animate-fade-in" style={{ minHeight: "calc(100vh - 56px)" }}>

      {/* ── "Report sa stále generuje" banner pre userov ktorí sa vrátili na stránku ── */}
      {report && !isFinished && report.status !== "CANCELLED" && (
        <div
          className="mt-4 mb-2 px-4 py-2.5 rounded-lg flex items-center gap-2 text-sm"
          style={{
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            color: "#93c5fd",
          }}
        >
          <svg className="animate-spin w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>
            {t("report.staleGeneruje") || "Váš report sa stále generuje. Môžete pokračovať v práci — automaticky sa aktualizuje."}
          </span>
        </div>
      )}

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
