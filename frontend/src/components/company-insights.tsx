"use client";

import type { Insight } from "@/lib/company-insights";
import { useT } from "@/components/LanguageProvider";

export function CompanyInsights({ insights }: { insights: Insight[] }) {
  const t = useT();
  if (insights.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8">
      <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.zakladneTrendy")}
      </h2>
      <div className="space-y-1.5">
        {insights.map((insight, i) => (
          <div
            key={i}
            className="rounded-lg p-2.5 text-sm leading-relaxed"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{insight.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
