"use client";

import { useT } from "@/components/LanguageProvider";

export default function FeaturesSection() {
  const t = useT();

  return (
    <section id="funkcie" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.featuresTitle")}</h2>
        <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>{t("home.featuresSubtitle")}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24 }} className="features-grid">
        {[
          { icon: "🔎", title: t("home.feature1Title"), desc: t("home.feature1Desc") },
          { icon: "📊", title: t("home.feature2Title"), desc: t("home.feature2Desc") },
          { icon: "📋", title: t("home.feature3Title"), desc: t("home.feature3Desc") },
        ].map((col) => (
          <div key={col.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                {col.icon}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700 }}>{col.title}</h3>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{col.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
