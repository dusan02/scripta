"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

const REPORT_INCLUDES = [
  { main: "Komplexná lustrácia registrov", sub: "ORSR, RPVS, RÚZ a ďalšie" },
  { main: "Exekúcie a insolvencia", sub: "Poverenia, Register úpadcov" },
  { main: "5-ročná finančná história", sub: "Súvaha, Výkaz ziskov, Cash flow" },
  { main: "Automatizovaný manažérsky posudok", sub: "Slovný posudok stavu firmy" },
  { main: "Daňové a odvodové dlhy", sub: "DPH, Fin. správa, poisťovne" },
  { main: "Záložné práva a dražby", sub: "Kontrola zaťaženia majetku" },
  { main: "Predikcia úpadku a zdravia", sub: "Altman Z-Score, Piotroski" },
  { main: "Originálne výpisy v príloho", sub: "Audit Trail pre právnu istotu" },
  { main: "Štátne zákazky a zmluvy", sub: "Lustrácia v CRZ a ÚVO" },
  { main: "Súdne sankcie a zákazy", sub: "Diskvalifikácie štatutárov" },
  { main: "Detekcia podvodov (Red Flags)", sub: "Forenzná analýza a mapa rizík" },
  { main: "Vizualizovaný PDF report", sub: "Prehľadné grafy a diagramy" },
];

const PRICING_PLANS = [
  {
    name: "1× Report",
    subtitle: "Komplexné preverenie firmy",
    credits: "1 report",
    price: "14 €",
    perCredit: "14,00 € / report",
    features: [
      "Pokrytie 20+ verejných a privátnych registrov",
      "Finančná a právna analýza s Verifa Score",
      "Profesionálny PDF report pripravený na zdieľanie",
      "Podpora: E-mail (SLA odozva do 24 hod.)",
    ],
    highlighted: false,
  },
  {
    name: "5× Report",
    subtitle: "5 reportov bez záväzku",
    credits: "5 reportov",
    price: "59 €",
    perCredit: "11,80 € / report",
    features: [
      "Všetko z balíka 1× Report",
      "Množstevná zľava",
      "História reportov a PDF archivácia",
      "Bez mesačného záväzku",
    ],
    highlighted: false,
  },
  {
    name: "20× Report",
    subtitle: "20 reportov so zľavou",
    credits: "20 reportov",
    price: "199 €",
    perCredit: "9,95 € / report",
    features: [
      "Všetko z balíka 1× Report",
      "Množstevná zľava",
      "História reportov a PDF archivácia",
      "Export reportu",
    ],
    highlighted: false,
  },
  {
    name: "Freelance",
    subtitle: "Pre účtovníkov a malé firmy",
    credits: "5 reportov / mesiac",
    price: "49 € / mesiac",
    perCredit: "9,80 € / report",
    features: [
      "Všetko z balíka 1× Report",
      "História reportov a PDF archivácia",
      "Rýchlejšie spracovanie analytickým jadrom",
      "Podpora: Chat (SLA odozva do 4 hod.)",
    ],
    highlighted: false,
  },
  {
    name: "Firma",
    subtitle: "Pre firmy s pravidelným Due Diligence",
    credits: "20 reportov / mesiac",
    price: "159 € / mesiac",
    perCredit: "7,95 € / report",
    features: [
      "Všetko z balíka Freelance",
      "Vhodné pre obchodné a nákupné tímy",
      "Prednostné spracovanie reportov bez čakania",
      "Podpora: Telefón (SLA odozva do 1 hod.)",
    ],
    highlighted: true,
  },
  {
    name: "Korporát",
    subtitle: "Pre profesionálov",
    credits: "40 reportov / mesiac",
    price: "289 € / mesiac",
    perCredit: "7,23 € / report",
    features: [
      "Všetko z balíka Firma",
      "Osobný account manager s okamžitou dostupnosťou",
      "API prístup pre interné systémy (Pripravujeme)",
      "Najnižšia cena za 1 komplexný report",
    ],
    highlighted: false,
  },
];

export default function PricingSection() {
  const t = useT();

  return (
    <section id="cennik" style={{ padding: "80px 24px", background: "var(--bg-subtle)", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.navPricing")}</h2>
        </div>

        {/* Čo obsahuje každý report */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "40px 32px", marginBottom: 48 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 32, textAlign: "center" }}>{t("home.reportIncludesTitle")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 report-includes-grid" style={{ gap: "28px 20px" }}>
            {REPORT_INCLUDES.map((item) => (
              <div key={item.main} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, marginTop: 2 }}>✓</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.4, marginBottom: 2 }}>{item.main}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{item.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pricing-grid" style={{ alignItems: "stretch" }}>
          {PRICING_PLANS.map((plan) => (
            <div key={plan.name} style={{ background: "var(--surface)", border: plan.highlighted ? "2px solid var(--accent)" : "1px solid var(--border)", borderRadius: 16, padding: 28, position: "relative", boxShadow: plan.highlighted ? "var(--shadow-lg)" : "var(--shadow-sm)" }}>
              {plan.highlighted && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "var(--accent-button-text)", padding: "4px 16px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {t("home.popular")}
                </div>
              )}
              <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 2 }}>{plan.name}</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>{plan.subtitle}</p>
              <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 4 }}>{plan.price}</div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>{plan.perCredit}</p>
              <Link href="/register" style={{ display: "block", textAlign: "center", background: plan.highlighted ? "var(--accent)" : "var(--surface-hover)", color: plan.highlighted ? "var(--accent-button-text)" : "var(--text)", border: plan.highlighted ? "none" : "1px solid var(--border)", padding: "10px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
                {t("home.startVerifying")}
              </Link>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.features.map((feat) => (
                  <li key={feat} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0 }}>✓</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginTop: 40, flexWrap: "wrap", fontSize: 14, color: "var(--text-secondary)" }} className="pricing-guarantee">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", fontSize: 18 }}>🛡️</span>
            <b>Garancia:</b> Ak report nemožno vygenerovať z dôvodu výpadku registrov, vrátime vám plnú sumu alebo pripíšeme kredit.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--accent)", fontSize: 18 }}>⏱️</span>
            Kredity sú platné <b>12 mesiacov</b> od zakúpenia.
          </div>
        </div>

        <p style={{ textAlign: "center", marginTop: 40, fontSize: 13, color: "var(--text-muted)" }}>
          {t("home.needMore")} <a href="mailto:info@verifa.sk" style={{ color: "var(--accent)", textDecoration: "none" }}>info@verifa.sk</a>
        </p>
      </div>
    </section>
  );
}
