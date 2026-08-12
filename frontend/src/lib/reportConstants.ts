export interface ReportSource {
  sourceType: string;
  status: string;
  statusMessage?: string | null;
  pageCount?: number | null;
  findings?: string | null;
}

export interface Report {
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
  updatedAt?: string | null;
  completedAt?: string | null;
  resultUrl?: string | null;
  aiStatus?: string | null;
  eta?: number | null;
  verifaScore?: number;
  sources: ReportSource[];
}

export const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "PARTIAL", "CANCELLED"];
export const POLL_INTERVAL_MS = 5000;

export const PHASE_WEIGHTS = {
  scraping: 30,
  aiPipeline: 50,
  verdict: 12,
  compiling: 8,
} as const;

export const AI_STATUS_RANGES: Record<string, { start: number; end: number; estSeconds: number }> = {
  "ai.queued":               { start: 0, end: 1, estSeconds: 10 },
  "ai.checking_registers":   { start: 0, end: 5, estSeconds: 10 },
  "ai.retrying":              { start: 0, end: 5, estSeconds: 10 },
  "ai.downloading":           { start: 5, end: 30, estSeconds: 55 },
  "ai.analyzing_statements":  { start: 30, end: 40, estSeconds: 15 },
  "ai.extracting_financials": { start: 40, end: 55, estSeconds: 120 },
  "ai.semantic_narrative":    { start: 55, end: 65, estSeconds: 60 },
  "ai.forensic_notes":        { start: 65, end: 72, estSeconds: 30 },
  "ai.risk_analysis":         { start: 72, end: 78, estSeconds: 20 },
  "ai.final_verdict":         { start: 78, end: 82, estSeconds: 10 },
  "ai.cross_validation":      { start: 82, end: 86, estSeconds: 15 },
  "ai.forensic_analysis":     { start: 86, end: 90, estSeconds: 15 },
  "ai.cross_correlation":     { start: 90, end: 95, estSeconds: 90 },
  "ai.risk_synthesis":        { start: 95, end: 97, estSeconds: 15 },
  "ai.compiling":             { start: 97, end: 99, estSeconds: 30 },
};

export function formatDate(iso: string, locale: string) {
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function computeWeightedProgress(
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
        const eased = 1 - Math.pow(1 - fraction, 2);
        aiProgress = range.start + (range.end - range.start) * eased;
      } else {
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

export function getPhaseLabel(aiStatus: string | null | undefined, t: (k: string) => string): string {
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

export interface LogEntry {
  status: string;
  text: string;
  timestamp: number;
}
