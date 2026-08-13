"use client";

import type { Insight } from "@/lib/company-insights";
import { useT } from "@/components/LanguageProvider";

export function CompanyInsights({ insights }: { insights: Insight[] }) {
  const t = useT();
  if (insights.length === 0) return null;

  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.zakladneTrendy")}
      </h2>
      <div className="space-y-1.5">
        {insights.map((insight, i) => (
          <div key={i} className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {insight.text}
          </div>
        ))}
      </div>
    </div>
  );
}
