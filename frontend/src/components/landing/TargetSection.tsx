"use client";

import { useT } from "@/components/LanguageProvider";

export default function TargetSection() {
  const t = useT();

  return (
    <section style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto" }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.whoIsItFor")}</h2>
        <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto" }}>{t("home.targetSubtitle")}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }} className="target-grid">
        {[
          { icon: "🏢", title: t("home.target1Title"), desc: t("home.target1Desc") },
          { icon: "⚖️", title: t("home.target2Title"), desc: t("home.target2Desc") },
          { icon: "💼", title: t("home.target3Title"), desc: t("home.target3Desc") },
        ].map((item) => (
          <div key={item.title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, transition: "transform 0.2s ease, box-shadow 0.2s ease" }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--accent-light)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, marginBottom: 16 }}>
              {item.icon}
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{item.title}</h3>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
