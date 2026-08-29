"use client";

import { useT } from "@/components/LanguageProvider";

type RiskSignal = {
  id: string;
  type: "legal_status" | "vestnik" | "forensic" | "financial";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  source: string;
  date?: string | null;
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "var(--danger, #dc2626)", bg: "var(--danger-bg, #fef2f2)", label: "Kritické" },
  high: { color: "var(--danger, #dc2626)", bg: "var(--danger-bg, #fef2f2)", label: "Vysoké" },
  medium: { color: "var(--warning, #d97706)", bg: "var(--warning-bg, #fffbeb)", label: "Stredné" },
  low: { color: "var(--text-muted)", bg: "var(--surface)", label: "Nízke" },
};

export function RiskSignals({ signals }: { signals: RiskSignal[] }) {
  const t = useT();
  if (signals.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8 no-print">
      <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.rizikoveSignaly") || "Rizikové signály a udalosti"}
      </h2>
      <div className="space-y-2">
        {signals.map((sig) => {
          const style = SEVERITY_STYLES[sig.severity] || SEVERITY_STYLES.low;
          return (
            <div
              key={sig.id}
              className="rounded-lg p-3 sm:p-4"
              style={{ background: style.bg, border: `1px solid var(--border)` }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: "var(--border)", color: "var(--text-muted)" }}>
                    {sig.source}
                  </span>
                  <span className="text-sm font-semibold" style={{ color: style.color }}>
                    {sig.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                    style={{ background: style.color, color: "white" }}
                  >
                    {style.label}
                  </span>
                  {sig.date && (
                    <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {sig.date}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {sig.description}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
