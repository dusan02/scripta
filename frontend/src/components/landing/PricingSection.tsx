"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";
import { PRICING_PLANS, REPORT_INCLUDES_KEYS } from "@/lib/pricing-plans";

export default function PricingSection() {
  const t = useT();

  return (
    <section id="pricing" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.navPricing")}</h2>
        </div>

        {/* Čo obsahuje každý report */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", marginBottom: 48 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 32, textAlign: "center" }}>{t("pricing.coObsahuje")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 report-includes-grid" style={{ gap: "28px 20px" }}>
            {REPORT_INCLUDES_KEYS.map((key) => (
              <div key={key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, fontSize: 13 }}>✓</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>{t(key)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pricing-grid" style={{ alignItems: "stretch" }}>
          {PRICING_PLANS.map((plan) => (
            <div key={plan.id} style={{ background: "var(--surface)", border: plan.highlight ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 16, padding: 28, position: "relative", boxShadow: plan.highlight ? "var(--shadow-lg)" : "var(--shadow-sm)" }}>
              {plan.highlight && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--accent-button-text)", padding: "4px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {t("home.popular")}
                </div>
              )}
              <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{t(plan.nameKey)}</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{t(plan.subtitleKey)}</p>
              <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 4 }}>{plan.price} €{plan.isSubscription ? " / mesiac" : ""}</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>
                {plan.isSubscription
                  ? t("pricing.mesiacne", { n: plan.reports, price: plan.pricePerReport })
                  : t("pricing.reportovZaReport", { n: plan.reports, price: plan.pricePerReport })}
              </p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>&nbsp;</p>
              <Link href="/register" style={{ display: "block", textAlign: "center", background: plan.highlight ? "var(--accent)" : "var(--surface-hover)", color: plan.highlight ? "var(--accent-button-text)" : "var(--text)", border: plan.highlight ? "none" : "1px solid var(--border)", padding: "10px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
                {t("home.startVerifying")}
              </Link>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.featureKeys.map((featKey) => (
                  <li key={featKey} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, fontSize: 12 }}>✓</span>
                    <span>{t(featKey)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginTop: 40, flexWrap: "wrap", fontSize: 14, color: "var(--text-secondary)" }} className="pricing-guarantee">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", fontSize: 18 }}>🛡️</span>
            <b>{t("home.guaranteeLabel")}</b> {t("home.guaranteeText")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", fontSize: 18 }}>⏱️</span>
            {t("home.creditsValid")} <b>{t("home.creditsValidPeriod")}</b> {t("home.creditsValidFrom")}
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 40, fontSize: 13, color: "var(--text-muted)" }}>
          {t("home.needMore")} <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
        </p>
      </div>
    </section>
  );
}
