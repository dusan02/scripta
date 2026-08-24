"use client";

import { useEffect, useState, useRef } from "react";
import { useT } from "@/components/LanguageProvider";
import {
  AI_STATUS_RANGES,
  PHASE_WEIGHTS,
  computeWeightedProgress,
  type ReportSource,
} from "@/lib/reportConstants";
import { SOURCES, SOURCE_CATEGORIES, SOURCE_DOT_COLOR } from "@/lib/sources";

const STATUS_ICON: Record<string, string> = {
  SUCCESS: "✓",
  FAILED: "✗",
  UNAVAILABLE: "⚠",
  PENDING: "",
  PROCESSING: "⏳",
};

// ── Inline SVG icons (24x24, stroke-width 1.5, line-art style) ──
function PhaseIconDatabase({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  );
}
function PhaseIconCpu({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  );
}
function PhaseIconShieldCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
function PhaseIconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
      <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
    </svg>
  );
}

// ── Workflow phases ──
const PHASES = [
  { id: 0, key: "report.phaseScraping",   Icon: PhaseIconDatabase,    range: [0, 30] },
  { id: 1, key: "report.phaseAiPipeline", Icon: PhaseIconCpu,         range: [30, 86] },
  { id: 2, key: "report.phaseVerdict",    Icon: PhaseIconShieldCheck, range: [86, 97] },
  { id: 3, key: "report.phaseCompiling",  Icon: PhaseIconFileText,    range: [97, 100] },
] as const;

function getActivePhase(progress: number, isTerminal: boolean): number {
  if (isTerminal) return 4; // all done
  for (let i = PHASES.length - 1; i >= 0; i--) {
    if (progress >= PHASES[i].range[0]) return i;
  }
  return 0;
}

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

  // Track elapsed time
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (isTerminal) return;
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isTerminal]);
  const showPatienceWarning = elapsedSec > 600 && !isTerminal;

  // Collapsible source checklist — hidden by default
  const [showSources, setShowSources] = useState(false);

  // Progress tracking
  const aiStatusRef = useRef<string | null>(null);
  const aiStatusStartedRef = useRef<number | null>(null);
  const _initialProgress = (() => {
    if (isTerminal) return 100;
    if (aiStatus && aiStatus in AI_STATUS_RANGES) return AI_STATUS_RANGES[aiStatus].start;
    if (sourcesTotal > 0) return (sourcesCompleted / sourcesTotal) * PHASE_WEIGHTS.scraping;
    return 0;
  })();
  const [displayProgress, setDisplayProgress] = useState(_initialProgress);
  const displayRef = useRef(_initialProgress);
  useEffect(() => { displayRef.current = displayProgress; }, [displayProgress]);

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

  // Source status map
  const sourceStatusMap = new Map<string, string>();
  for (const s of sources) {
    sourceStatusMap.set(s.sourceType, s.status);
  }
  const selectedSourceIds = sources.map(s => s.sourceType);
  const categoriesWithSources = SOURCE_CATEGORIES.map(cat => ({
    ...cat,
    sources: SOURCES.filter(s => s.category === cat.id && selectedSourceIds.includes(s.id)),
  })).filter(cat => cat.sources.length > 0);

  const activePhase = getActivePhase(displayProgress, isTerminal);
  const fmtTime = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="mt-8 flex flex-col items-center max-w-2xl mx-auto w-full px-2 fade-in">
      {/* ── Main card: status + progress ── */}
      <div className="w-full rounded-2xl p-4 shadow-sm fade-in" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        {/* Top: spinner + status text + % */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center relative" style={{ background: "var(--accent-light)" }}>
              <svg className="w-4 h-4 animate-spin relative z-10" style={{ color: "var(--accent)" }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <div className="absolute inset-0 rounded-full opacity-20 animate-ping" style={{ background: "var(--accent)" }}></div>
            </div>
            <span className="text-[14px] font-medium leading-snug truncate" style={{ color: "var(--accent)" }}>
              {statusText}
            </span>
          </div>
          <span className="shrink-0 text-2xl font-bold tabular-nums leading-none" style={{ color: "var(--accent)" }}>
            {Math.round(displayProgress)}<span className="text-sm font-semibold">%</span>
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
          <div className="h-full rounded-full ease-linear" style={{ width: `${displayProgress}%`, background: "var(--accent)", transition: "width 500ms linear" }} />
        </div>

        {/* Elapsed + ETA */}
        {!isTerminal && (
          <div className="flex items-center gap-4 mt-2 text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
            <span>⏱ {fmtTime(elapsedSec)}</span>
            {etaCountdown !== null && etaCountdown > 0 && (
              <span>~{fmtTime(etaCountdown)}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Workflow stepper ── */}
      <div className="w-full mt-3 rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-start justify-between gap-1">
          {PHASES.map((phase, i) => {
            const isDone = activePhase > i || isTerminal;
            const isActive = activePhase === i && !isTerminal;
            const isPending = activePhase < i && !isTerminal;
            const phaseLabel = t(phase.key);

            return (
              <div key={phase.id} className="flex flex-col items-center flex-1 min-w-0">
                {/* Circle + connector line */}
                <div className="flex items-center w-full justify-center relative">
                  {/* Left connector */}
                  {i > 0 && (
                    <div
                      className="absolute right-1/2 h-0.5 w-1/2"
                      style={{
                        background: isDone || isActive ? "var(--accent)" : "var(--border)",
                        transition: "background 300ms",
                      }}
                    />
                  )}
                  {/* Circle */}
                  <div
                    className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isActive ? "animate-pulse" : ""}`}
                    style={{
                      background: isDone ? "var(--success)" : isActive ? "var(--accent)" : "var(--bg-muted)",
                      border: `2px solid ${isDone ? "var(--success)" : isActive ? "var(--accent)" : "var(--border)"}`,
                      color: isDone || isActive ? "#fff" : "var(--text-muted)",
                      transition: "all 300ms",
                    }}
                  >
                    {isDone ? (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    ) : (
                      <phase.Icon className="w-4 h-4" />
                    )}
                  </div>
                  {/* Right connector */}
                  {i < PHASES.length - 1 && (
                    <div
                      className="absolute left-1/2 h-0.5 w-1/2"
                      style={{
                        background: isDone ? "var(--accent)" : "var(--border)",
                        transition: "background 300ms",
                      }}
                    />
                  )}
                </div>
                {/* Label */}
                <span
                  className="text-[10px] font-medium text-center mt-1.5 leading-tight"
                  style={{
                    color: isActive ? "var(--accent)" : isDone ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {phaseLabel}
                </span>
                {/* Sub-label: source count for phase 0 */}
                {i === 0 && sourcesTotal > 0 && (
                  <span className="text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {sourcesCompleted}/{sourcesTotal}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Collapsible source checklist ── */}
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowSources(v => !v)}
            className="w-full flex items-center justify-between text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--text-secondary)" }}
          >
            <span className="flex items-center gap-1.5">
              <span>📋</span>
              <span>{t("report.zdrojov")}</span>
              <span className="tabular-nums" style={{ color: "var(--accent)" }}>{sourcesCompleted}/{sourcesTotal}</span>
            </span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {showSources ? "▲ skryť" : "▼ zobraziť"}
            </span>
          </button>
          {showSources && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {categoriesWithSources.map(cat => {
                const completed = cat.sources.filter(s => ["SUCCESS", "FAILED", "UNAVAILABLE"].includes(sourceStatusMap.get(s.id) || "")).length;
                const allDone = completed === cat.sources.length;
                return (
                  <div key={cat.id}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: allDone ? "var(--text-muted)" : "var(--text-secondary)" }}>
                        {cat.label}
                      </span>
                      <span className="text-[9px] font-semibold tabular-nums shrink-0 ml-1" style={{ color: "var(--text-muted)" }}>
                        {completed}/{cat.sources.length}
                      </span>
                    </div>
                    {cat.sources.map(src => {
                      const status = sourceStatusMap.get(src.id) || "PENDING";
                      const icon = STATUS_ICON[status] || "";
                      const color = SOURCE_DOT_COLOR[status] || "var(--border-strong)";
                      const isProcessing = status === "PROCESSING";
                      return (
                        <div key={src.id} className="flex items-center gap-1 text-[10px] leading-tight py-px">
                          <span
                            className={`shrink-0 w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold ${isProcessing ? "animate-pulse" : ""}`}
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
                );
              })}
            </div>
          )}
        </div>
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
