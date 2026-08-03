"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

const VERIFA_PRICE = 14;
const VERIFA_MINUTES = 8;

export default function RoiSection() {
  const t = useT();
  const [hours, setHours] = useState(2.5);
  const [rate, setRate] = useState(35);

  const manualCost = hours * rate;
  const verifaCost = VERIFA_PRICE;
  const savings = manualCost - verifaCost;
  const savingsPct = manualCost > 0 ? Math.round((savings / manualCost) * 100) : 0;
  const manualMinutes = Math.round(hours * 60);

  return (
    <section id="roi" style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto" }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>
          {t("home.roiTitle")}
        </h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto" }}>
          {t("home.roiSubtitle")}
        </p>
      </div>

      {/* Calculator */}
      <div className="card p-6 sm:p-8 mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16 }}>
        <div className="mb-6">
          <label className="block text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>
            {t("home.roiSliderLabel")}
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0.5"
              max="6"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(parseFloat(e.target.value))}
              className="flex-1"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-lg font-bold min-w-[60px] text-right" style={{ color: "var(--accent)" }}>
              {hours} h
            </span>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>
            {t("home.roiHourlyRate")}
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="15"
              max="50"
              step="5"
              value={rate}
              onChange={(e) => setRate(parseInt(e.target.value))}
              className="flex-1"
              style={{ accentColor: "var(--accent)" }}
            />
            <span className="text-lg font-bold min-w-[60px] text-right" style={{ color: "var(--accent)" }}>
              {rate} €/h
            </span>
          </div>
        </div>

        {/* Results — compact inline */}
        <div className="flex items-stretch gap-3 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <div className="flex-1 p-3 text-center" style={{ background: "var(--bg-muted)" }}>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("home.roiManual")}</p>
            <p className="text-xl font-black" style={{ color: "var(--text)" }}>{manualCost.toFixed(0)} €</p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{manualMinutes} min</p>
          </div>
          <div className="flex-1 p-3 text-center" style={{ background: "var(--accent-light)" }}>
            <p className="text-[11px]" style={{ color: "var(--accent)" }}>{t("home.roiVerifa")}</p>
            <p className="text-xl font-black" style={{ color: "var(--accent)" }}>{verifaCost} €</p>
            <p className="text-[11px]" style={{ color: "var(--accent)" }}>~{VERIFA_MINUTES} min</p>
          </div>
          <div className="flex-1 p-3 text-center" style={{ background: "var(--success-bg)" }}>
            <p className="text-[11px]" style={{ color: "var(--success)" }}>{t("home.roiSavings")}</p>
            <p className="text-xl font-black" style={{ color: "var(--success)" }}>
              {savings > 0 ? `${savings.toFixed(0)} €` : "0 €"}
            </p>
            <p className="text-[11px]" style={{ color: "var(--success)" }}>({savingsPct}%)</p>
          </div>
        </div>
      </div>

      {/* Comparison table */}
      <div className="card overflow-hidden" style={{ border: "1px solid var(--border)", borderRadius: 16 }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-muted)" }}>
              <th className="text-left p-4 text-sm font-semibold" style={{ color: "var(--text)" }}></th>
              <th className="text-center p-4 text-sm font-semibold" style={{ color: "var(--text-muted)" }}>{t("home.roiManual")}</th>
              <th className="text-center p-4 text-sm font-semibold" style={{ color: "var(--accent)" }}>{t("home.roiVerifa")}</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: t("home.roiTime"), manual: `${manualMinutes} min`, verifa: `~${VERIFA_MINUTES} min` },
              { label: t("home.roiCost"), manual: `${manualCost.toFixed(0)} €`, verifa: `${verifaCost} €` },
              { label: t("home.roiRegistre"), manual: t("home.roiRegistreManual"), verifa: t("home.roiRegistreVerifa") },
              { label: t("home.roiAnalysis"), manual: t("home.roiAnalysisManual"), verifa: t("home.roiAnalysisVerifa") },
              { label: t("home.roiPdf"), manual: t("home.roiPdfManual"), verifa: t("home.roiPdfVerifa") },
            ].map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                <td className="p-4 text-sm font-medium" style={{ color: "var(--text)" }}>{row.label}</td>
                <td className="p-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>{row.manual}</td>
                <td className="p-4 text-center text-sm font-semibold" style={{ color: "var(--accent)" }}>{row.verifa}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-center mt-8">
        <Link
          href="/register"
          className="inline-block px-8 py-4 rounded-xl no-underline font-bold text-[16px] transition-all hover:opacity-90"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--shadow-lg)" }}
        >
          {t("home.roiCta")}
        </Link>
      </div>
    </section>
  );
}
