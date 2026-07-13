"use client";

import { useT } from "@/components/LanguageProvider";

export default function FaqSection() {
  const t = useT();

  return (
    <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 60 }}>
        <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.faqTitle")}</h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {[
          { q: t("home.faq1q"), a: t("home.faq1a") },
          { q: t("home.faq2q"), a: t("home.faq2a") },
          { q: t("home.faq3q"), a: t("home.faq3a") },
          { q: t("home.faq5q"), a: t("home.faq5a") },
        ].map((item, i) => (
          <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{item.q}</h3>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
