"use client";

import type { Insight } from "@/lib/company-insights";
import { useT } from "@/components/LanguageProvider";

export function CompanyInsights({ insights }: { insights: Insight[] }) {
  const t = useT();
  if (insights.length === 0) return null;

  return (
    <div className="mb-4 sm:mb-6">
      <h2 className="text-sm sm:text-base font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("firma.zakladneTrendy")}
      </h2>
      <div className="space-y-1">
        {insights.map((insight, i) => (
          <div
            key={i}
            className="rounded-lg px-3 py-1.5 text-xs sm:text-sm leading-relaxed"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{insight.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
