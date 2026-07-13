"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function HeroSection() {
  const t = useT();

  return (
    <section style={{ paddingTop: 140, paddingBottom: 80, position: "relative", overflow: "hidden" }} className="hero-pad">
      <div style={{ position: "absolute", top: -200, right: -100, width: 500, height: 500, borderRadius: "50%", background: "var(--accent)", opacity: 0.06, filter: "blur(80px)" }} />
      <div style={{ position: "absolute", top: 100, left: -150, width: 400, height: 400, borderRadius: "50%", background: "var(--accent)", opacity: 0.04, filter: "blur(60px)" }} />

      <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center", padding: "0 24px", position: "relative" }}>
        <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 999, background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)", fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
          ⚡ {t("home.badge")}
        </div>

        <h1 style={{ fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 900, lineHeight: 1.05, letterSpacing: "-0.03em", marginBottom: 24 }}>
          {t("home.heroTitle1")}<br /><span style={{ color: "var(--accent)" }}>{t("home.heroTitle2")}</span>
        </h1>

        <p style={{ fontSize: "clamp(16px, 2.5vw, 20px)", color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 680, margin: "0 auto 40px" }}>
          {t("home.heroSubtitle")}
        </p>

        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }} className="hero-cta">
          <Link href="/register" style={{ background: "var(--accent)", color: "var(--accent-button-text)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "var(--shadow-lg)" }}>
            {t("home.ctaStart")}
          </Link>
          <a href="#how" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 16 }}>
            {t("home.howItWorks")}
          </a>
        </div>

        <div style={{ marginTop: 48, display: "flex", gap: 32, justifyContent: "center", flexWrap: "wrap" }} className="hero-stats">
          {[
            { num: "20+", label: t("home.statRegisters") },
            { num: "~5 min", label: t("home.statAvgTime") },
            { num: "0-100", label: t("home.statScoreRange") },
            { num: "1 PDF", label: t("home.statReport") },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "var(--accent)" }}>{s.num}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
