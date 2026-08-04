"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function CtaSection() {
  const t = useT();

  return (
    <section style={{ padding: "80px 24px" }} className="section-pad">
      <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: "52px 36px", position: "relative", overflow: "hidden" }} className="cta-card">
        <div style={{ position: "absolute", top: -100, right: -50, width: 300, height: 300, borderRadius: "50%", background: "var(--accent)", opacity: 0.05, filter: "blur(60px)" }} />
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 32px)", fontWeight: 800, marginBottom: 14 }}>{t("home.ctaTitle")}</h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 28 }}>{t("home.ctaDesc")}</p>
        <Link href="/register" style={{ display: "inline-block", background: "var(--accent)", color: "var(--accent-button-text)", padding: "14px 36px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 15, boxShadow: "var(--shadow-lg)" }}>
          {t("home.ctaStartNow")}
        </Link>
      </div>
    </section>
  );
}
