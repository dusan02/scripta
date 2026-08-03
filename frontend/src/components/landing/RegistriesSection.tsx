"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";

const REGISTRY_GROUPS = [
  {
    icon: "🏢",
    categoryKey: "landing.regGroup1",
    items: ["Obchodný register SR (ORSR)", "Živnostenský register (ŽRSR)", "Register právnických osôb (RPO)", "Register partnerov ver. sektora (RPVS)", "Obchodný vestník"],
  },
  {
    icon: "⚠️",
    categoryKey: "landing.regGroup2",
    items: ["Register úpadcov", "Poverenia na exekúcie", "Daňoví dlžníci", "Sociálna poisťovňa", "VšZP", "Dôvera", "Union"],
  },
  {
    icon: "💰",
    categoryKey: "landing.regGroup3",
    items: ["Index daň. spoľahlivosti", "Platitelia DPH", "Zrušenie DPH", "Vymazaní z DPH", "Nadmerný odpočet", "Daň z príjmov PO", "Reg. k dani z príjmov"],
  },
  {
    icon: "⚖️",
    categoryKey: "landing.regGroup4",
    items: ["Register diskvalifikácií"],
  },
  {
    icon: "🏛️",
    categoryKey: "landing.regGroup5",
    items: ["Účtovné závierky (RÚZ)", "Register zmlúv (CRZ)", "Verejné obstarávanie (ÚVO)"],
  },
  {
    icon: "🛡️",
    categoryKey: "landing.regGroup6",
    items: ["Záložné práva", "Register dražieb"],
  },
];

export default function RegistriesSection() {
  const t = useT();
  const [showRegistries, setShowRegistries] = useState(true);

  return (
    <section id="registre" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>{t("home.registriesTitle")}</h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto" }}>{t("home.registriesSubtitle")}</p>
      </div>

      <div style={{ textAlign: "center", marginBottom: showRegistries ? 36 : 0 }}>
        <button
          onClick={() => setShowRegistries((v) => !v)}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "12px 24px",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            transition: "border-color 0.2s",
          }}
        >
          {showRegistries ? t("home.registriesHide") : t("home.registriesShow")}
          <span style={{ color: "var(--accent)", fontSize: 16, transition: "transform 0.2s", display: "inline-block", transform: showRegistries ? "rotate(180deg)" : "none" }}>⌄</span>
        </button>
      </div>

      {showRegistries && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "stretch" }} className="registries-grid">
          {REGISTRY_GROUPS.map((group) => (
            <div key={group.categoryKey} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, display: "flex", flexDirection: "column" }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 14 }}>
                {group.icon}
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{t(group.categoryKey)}</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                {group.items.map((r) => (
                  <li key={r} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0 }}>✓</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
