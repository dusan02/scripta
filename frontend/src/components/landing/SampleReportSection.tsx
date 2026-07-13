"use client";

import { useT } from "@/components/LanguageProvider";

export default function SampleReportSection() {
  const t = useT();

  return (
    <section id="ukazka" style={{ padding: "80px 24px", background: "var(--bg-subtle)" }} className="section-pad">
      <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>{t("home.sampleTitle")}</h2>
        <p style={{ fontSize: 17, color: "var(--text-secondary)", maxWidth: 600, margin: "0 auto 32px" }}>{t("home.sampleDesc")}</p>
        <a href="/ukazka-reportu.pdf" target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "14px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 15 }}>
          {t("nav.dokumenty")} →
        </a>
      </div>
    </section>
  );
}
