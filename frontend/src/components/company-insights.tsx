"use client";

import type { Insight } from "@/lib/company-insights";
import { useT } from "@/components/LanguageProvider";

const SEVERITY_CONFIG = {
  positive: { icon: "↑", color: "#10b981", bg: "rgba(16, 185, 129, 0.08)" },
  negative: { icon: "↓", color: "#ef4444", bg: "rgba(239, 68, 68, 0.08)" },
  warning: { icon: "!", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.08)" },
  neutral: { icon: "·", color: "var(--text-muted)", bg: "transparent" },
} as const;

export function CompanyInsights({ insights }: { insights: Insight[] }) {
  const t = useT();
  if (insights.length === 0) return null;

  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.zakladneTrendy")}
      </h2>
      <div className="space-y-1.5">
        {insights.map((insight, i) => {
          const cfg = SEVERITY_CONFIG[insight.severity || "neutral"];
          return (
            <div
              key={i}
              className="flex items-start gap-2 text-xs sm:text-sm leading-relaxed rounded-md px-2 py-1"
              style={{ color: "var(--text-secondary)", background: cfg.bg }}
            >
              <span className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{ color: cfg.color }}>
                {cfg.icon}
              </span>
              <span>{insight.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
