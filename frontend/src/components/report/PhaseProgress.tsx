"use client";

import { useEffect, useState, useRef } from "react";
import { useT } from "@/components/LanguageProvider";
import {
  AI_STATUS_RANGES,
  PHASE_WEIGHTS,
  computeWeightedProgress,
  type ReportSource,
} from "@/lib/reportConstants";
import { SOURCES, SOURCE_CATEGORIES, SOURCE_MAP, SOURCE_DOT_COLOR } from "@/lib/sources";

const STATUS_ICON: Record<string, string> = {
  SUCCESS: "✓",
  FAILED: "✗",
  UNAVAILABLE: "⚠",
  PENDING: "",
  PROCESSING: "⏳",
};

export default function PhaseProgress({
  sources,
  sourcesCompleted,
  sourcesTotal,
  aiStatus,
  reportStatus,
  etaCountdown,
  locale,
  startedAt,
  serverUpdatedAt,
}: {
  sources: ReportSource[];
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
  const statusText = aiStatus ? t(aiStatus) : t("report.processing");
  const isScraping = !aiStatus || aiStatus === "ai.queued" || aiStatus === "ai.checking_registers" || aiStatus === "ai.retrying";
  const isTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(reportStatus);

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
  useEffect(() => {
    if (aiStatus !== aiStatusRef.current) {
      aiStatusRef.current = aiStatus ?? null;
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
      const step = Math.max(0.15, diff * 0.12);
      setDisplayProgress(Math.min(target, current + step));
    }, 500);
    return () => clearInterval(interval);
  }, [sourcesCompleted, sourcesTotal, aiStatus, reportStatus, isTerminal]);

  // Build a map of sourceType → status from the live sources data
  const sourceStatusMap = new Map<string, string>();
  for (const s of sources) {
    sourceStatusMap.set(s.sourceType, s.status);
  }

  // Group sources by category, only show sources that were selected for this report
  const selectedSourceIds = sources.map(s => s.sourceType);
  const categoriesWithSources = SOURCE_CATEGORIES.map(cat => ({
    ...cat,
    sources: SOURCES.filter(s => s.category === cat.id && selectedSourceIds.includes(s.id)),
  })).filter(cat => cat.sources.length > 0);

  return (
    <div className="mt-8 flex flex-col items-center max-w-2xl mx-auto w-full px-2 fade-in">
      {/* Loader card */}
      <div className="w-full rounded-2xl p-4 shadow-sm relative fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {/* Top row: icon + % */}
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
          {/* Percentage badge */}
          <span className="shrink-0 text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--accent)" }}>
            {Math.round(displayProgress)}<span className="text-sm font-semibold">%</span>
          </span>
        </div>

        {/* Status text — no timestamp */}
        <div className="flex items-baseline gap-1.5 flex-wrap">
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

      {/* Elapsed time + ETA */}
      {!isTerminal && (
        <div className="flex items-center gap-3 mt-3 text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          <span>⏱ {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:{String(elapsedSec % 60).padStart(2, "0")}</span>
          {etaCountdown !== null && etaCountdown > 0 && (
            <span style={{ color: "var(--text-muted)" }}>~{String(Math.floor(etaCountdown / 60)).padStart(2, "0")}:{String(etaCountdown % 60).padStart(2, "0")}</span>
          )}
        </div>
      )}

      {/* ── Source checklist ── */}
      <div className="w-full mt-4 rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {categoriesWithSources.map(cat => {
          const completed = cat.sources.filter(s => ["SUCCESS", "FAILED", "UNAVAILABLE"].includes(sourceStatusMap.get(s.id) || "")).length;
          return (
            <div key={cat.id} className="mb-3 last:mb-0">
              {/* Category header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  {cat.label}
                </span>
                <span className="text-[10px] font-semibold tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {completed}/{cat.sources.length}
                </span>
              </div>
              {/* Source items */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {cat.sources.map(src => {
                  const status = sourceStatusMap.get(src.id) || "PENDING";
                  const icon = STATUS_ICON[status] || "";
                  const color = SOURCE_DOT_COLOR[status] || "var(--border-strong)";
                  const isProcessing = status === "PROCESSING";
                  return (
                    <div key={src.id} className="flex items-center gap-2 text-xs py-0.5">
                      <span
                        className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${isProcessing ? "animate-pulse" : ""}`}
                        style={{
                          color: status === "PENDING" ? "var(--border-strong)" : "#fff",
                          background: status === "PENDING" ? "transparent" : color,
                          border: status === "PENDING" ? `1.5px solid ${color}` : "none",
                        }}
                      >
                        {icon}
                      </span>
                      <span
                        className="truncate"
                        style={{
                          color: status === "SUCCESS" ? "var(--text)" : status === "PENDING" ? "var(--text-muted)" : "var(--text-secondary)",
                          fontWeight: status === "SUCCESS" ? 500 : 400,
                        }}
                      >
                        {src.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

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
