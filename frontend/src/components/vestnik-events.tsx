"use client";

import { ChartCard } from "@/components/firma-ui";
import { useT } from "@/components/LanguageProvider";

type VestnikEvent = {
  id: string;
  eventType: string;
  severityLevel: string;
  summary: string;
  publishedAt: Date;
};

const SEVERITY_STYLES: Record<string, { color: string; bg: string; labelKey: string }> = {
  CRITICAL: { color: "var(--danger)", bg: "var(--danger-bg)", labelKey: "firma.kriticke" },
  HIGH: { color: "var(--danger)", bg: "var(--danger-bg)", labelKey: "firma.vysoke" },
  MEDIUM: { color: "var(--warning)", bg: "var(--warning-bg)", labelKey: "firma.stredne" },
  LOW: { color: "var(--text-muted)", bg: "var(--surface)", labelKey: "firma.nizke" },
};

export function VestnikEvents({ events, noHeading }: { events: VestnikEvent[]; noHeading?: boolean }) {
  const t = useT();
  if (events.length === 0) return null;

  return (
    <div className={noHeading ? "" : "mb-6 sm:mb-8"}>
      {!noHeading && (
        <h2 className="text-lg sm:text-xl font-bold mb-3" style={{ color: "var(--text)" }}>
          {t("firma.vestnikUdalosti") || "Udalosti z Obchodného vestníka"}
        </h2>
      )}
      <div className="space-y-2">
        {events.map((ev) => {
          const style = SEVERITY_STYLES[ev.severityLevel] || SEVERITY_STYLES.LOW;
          return (
            <div
              key={ev.id}
              className="rounded-lg p-3 sm:p-4"
              style={{ background: style.bg, border: `1px solid var(--border)` }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-sm font-semibold" style={{ color: style.color }}>
                  {ev.eventType}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                    style={{ background: style.color, color: "white" }}
                  >
                    {t(style.labelKey)}
                  </span>
                  <span className="text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {new Date(ev.publishedAt).toLocaleDateString("sk-SK")}
                  </span>
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {ev.summary}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
