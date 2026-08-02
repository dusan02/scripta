import type { Insight } from "@/lib/company-insights";
import { useT } from "@/components/LanguageProvider";

const CATEGORY_STYLES: Record<Insight["category"], { color: string; bg: string; icon: string }> = {
  positive: { color: "#10b981", bg: "rgba(16,185,129,0.08)", icon: "✓" },
  negative: { color: "#ef4444", bg: "rgba(239,68,68,0.08)", icon: "✗" },
  warning: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", icon: "⚠" },
  neutral: { color: "var(--text-muted)", bg: "var(--surface)", icon: "•" },
};

export function CompanyInsights({ insights }: { insights: Insight[] }) {
  const t = useT();
  if (insights.length === 0) return null;

  return (
    <div className="mb-6 sm:mb-8">
      <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.zakladneTrendy")}
      </h2>
      <div className="space-y-2">
        {insights.map((insight, i) => {
          const style = CATEGORY_STYLES[insight.category];
          return (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg p-3 text-sm leading-relaxed"
              style={{ background: style.bg, border: `1px solid ${style.color}22` }}
            >
              <span className="font-bold flex-shrink-0" style={{ color: style.color }}>{style.icon}</span>
              <span style={{ color: "var(--text-secondary)" }}>{insight.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
