"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";

const REGISTRY_GROUPS = [
  {
    icon: "🏢",
    category: "Základné firemné a právne registre",
    items: ["Obchodný register SR (ORSR)", "Živnostenský register (ŽRSR)", "Register právnických osôb (RPO)", "Register partnerov ver. sektora (RPVS)", "Obchodný vestník"],
  },
  {
    icon: "⚠️",
    category: "Insolvencia, exekúcie a dlhy",
    items: ["Register úpadcov", "Poverenia na exekúcie", "Daňoví dlžníci", "Sociálna poisťovňa", "VšZP", "Dôvera", "Union"],
  },
  {
    icon: "💰",
    category: "Finančná správa a DPH",
    items: ["Index daň. spoľahlivosti", "Platitelia DPH", "Zrušenie DPH", "Vymazaní z DPH", "Nadmerný odpočet", "Daň z príjmov PO", "Reg. k dani z príjmov"],
  },
  {
    icon: "⚖️",
    category: "Súdy a sankcie",
    items: ["Register diskvalifikácií"],
  },
  {
    icon: "🏛️",
    category: "Financie a štátne zákazky",
    items: ["Účtovné závierky (RÚZ)", "Register zmlúv (CRZ)", "Verejné obstarávanie (ÚVO)"],
  },
  {
    icon: "🛡️",
    category: "Majetok a práva",
    items: ["Záložné práva", "Register dražieb"],
  },
];

export default function RegistriesSection() {
  const t = useT();
  const [showRegistries, setShowRegistries] = useState(true);

  return (
    <section id="registre" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.registriesTitle")}</h2>
        <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>{t("home.registriesSubtitle")}</p>
      </div>

      <div style={{ textAlign: "center", marginBottom: showRegistries ? 40 : 0 }}>
        <button
          onClick={() => setShowRegistries((v) => !v)}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "14px 28px",
            fontSize: 15,
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
          <span style={{ color: "var(--accent)", fontSize: 18, transition: "transform 0.2s", display: "inline-block", transform: showRegistries ? "rotate(180deg)" : "none" }}>⌄</span>
        </button>
      </div>

      {showRegistries && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "stretch" }} className="registries-grid">
          {REGISTRY_GROUPS.map((group) => (
            <div key={group.category} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 16 }}>
                {group.icon}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>{group.category}</h3>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {group.items.map((r) => (
                  <li key={r} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent)", fontWeight: 900, flexShrink: 0, marginTop: 1 }}>✓</span>
                    {r}
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
