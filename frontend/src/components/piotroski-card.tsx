"use client";

import { useT } from "@/components/LanguageProvider";
import type { PiotroskiResult } from "@/lib/piotroski";

export function PiotroskiCard({ result, noHeading }: { result: PiotroskiResult | null; noHeading?: boolean }) {
  const t = useT();
  if (!result) return null;

  const { score, maxScore, criteria, year, prevYear } = result;

  const assessment = score >= 7
    ? t("firma.piotroskiSilny") || "Silná finančná pozícia"
    : score <= 3
    ? t("firma.piotroskiSlaby") || "Slabá finančná pozícia"
    : t("firma.piotroskiStredny") || "Priemerná finančná pozícia";

  const scoreColor = score >= 7 ? "#10b981" : score <= 3 ? "#ef4444" : "#f59e0b";

  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      {!noHeading && (
        <h2 className="text-base sm:text-lg font-bold mb-3" style={{ color: "var(--text)" }}>
          {`Piotroski F-Score — ${year}`}
        </h2>
      )}
      <div className="flex items-center gap-4 mb-3">
        <div className="text-3xl font-black" style={{ color: scoreColor }}>
          {score}
          <span className="text-base font-normal" style={{ color: "var(--text-muted)" }}>/{maxScore}</span>
        </div>
        <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {assessment}
        </div>
      </div>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        {t("firma.piotroskiDesc") || `9 kritérií finančnej kvality za obdobie ${prevYear}–${year}. Vyššie skóre = lepšia finančná kondícia.`}
      </p>
      <div className="space-y-1">
        {criteria.map((c) => (
          <div key={c.key} className="flex items-center gap-2 text-xs">
            <span
              className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                color: c.passed === true ? "#10b981" : c.passed === false ? "#ef4444" : "var(--text-muted)",
                background: c.passed === true ? "rgba(16,185,129,0.1)" : c.passed === false ? "rgba(239,68,68,0.1)" : "var(--surface)",
              }}
            >
              {c.passed === true ? "✓" : c.passed === false ? "✗" : "—"}
            </span>
            <span style={{ color: c.passed === null ? "var(--text-muted)" : "var(--text-secondary)" }}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
