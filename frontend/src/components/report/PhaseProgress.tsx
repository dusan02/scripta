"use client";

import { useEffect, useState, useRef } from "react";
import { useT } from "@/components/LanguageProvider";
import {
  AI_STATUS_RANGES,
  PHASE_WEIGHTS,
  computeWeightedProgress,
  getPhaseLabel,
  type LogEntry,
} from "@/lib/reportConstants";

export default function PhaseProgress({
  sourcesCompleted,
  sourcesTotal,
  aiStatus,
  reportStatus,
  etaCountdown,
  locale,
  startedAt,
  serverUpdatedAt,
}: {
  sourcesCompleted: number;
  sourcesTotal: number;
  aiStatus?: string | null;
  reportStatus: string;
  etaCountdown: number | null;
  locale: string;
  startedAt: number;
  serverUpdatedAt?: string | null;
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

  // Use server-side updatedAt as the reference for AI status timing.
  // This ensures progress is consistent across page refreshes and tab
  // suspensions — the server timestamp doesn't change when the browser
  // sleeps, so elapsed time is always accurate.
  useEffect(() => {
    if (aiStatus !== aiStatusRef.current) {
      aiStatusRef.current = aiStatus ?? null;
      // Use server updatedAt (when the status was last set) instead of
      // Date.now() — this survives refreshes and mobile tab suspension.
      const serverTs = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : Date.now();
      aiStatusStartedRef.current = serverTs;
    }
  }, [aiStatus, serverUpdatedAt]);

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
            <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center relative" style={{ background: "var(--accent-light)" }}>
              <svg className="w-4 h-4 animate-spin relative z-10" style={{ color: "var(--accent)" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <div className="absolute inset-0 rounded-full opacity-20 animate-ping" style={{ background: "var(--accent)" }}></div>
            </div>
            {isScraping && sourcesTotal > 0 && (
              <span className="text-xs font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>
                {sourcesCompleted}/{sourcesTotal} {t("report.zdrojov")}
              </span>
            )}
          </div>
          {/* Percentage badge — always top-right, never wraps into text */}
          <span className="shrink-0 text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--accent)" }}>
            {Math.round(displayProgress)}<span className="text-sm font-semibold">%</span>
          </span>
        </div>

        {/* Status text — full width, no competition with % */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="shrink-0 tabular-nums text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            [{new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}]
          </span>
          <span className="text-[14px] font-medium leading-snug" style={{ color: "var(--accent)" }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* Weighted progress bar */}
      <div className="w-full mt-4">
        <div className="w-full h-2.5 rounded-full overflow-hidden relative" style={{ background: "var(--border)" }}>
          <div
            className="h-full rounded-full ease-linear"
            style={{ width: `${displayProgress}%`, background: "var(--accent)", transition: "width 500ms linear" }}
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
                <span style={{ color: isLast ? "var(--accent)" : "var(--text-muted)", fontWeight: isLast ? 500 : 400 }}>
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
