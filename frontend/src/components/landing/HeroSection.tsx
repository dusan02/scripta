"use client";

import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function HeroSection() {
  const t = useT();

  return (
    <section className="relative overflow-hidden pt-35 pb-20 hero-pad">
      <div className="absolute -top-50 -right-25 w-125 h-125 rounded-full opacity-[0.06] blur-[80px]" style={{ background: "var(--accent)" }} />
      <div className="absolute top-25 -left-38 w-100 h-100 rounded-full opacity-[0.04] blur-[60px]" style={{ background: "var(--accent)" }} />

      <div className="relative max-w-[900px] mx-auto text-center px-6">
        <div className="inline-block px-4 py-1.5 rounded-full text-[13px] font-semibold mb-6" style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
          ⚡ {t("home.badge")}
        </div>

        <h1 className="font-black leading-[1.05] tracking-[-0.03em] mb-6" style={{ fontSize: "clamp(36px, 6vw, 64px)" }}>
          {t("home.heroTitle1")}<br /><span style={{ color: "var(--accent)" }}>{t("home.heroTitle2")}</span>
        </h1>

        <p className="text-[var(--text-secondary)] leading-relaxed mx-auto mb-10" style={{ fontSize: "clamp(16px, 2.5vw, 20px)", maxWidth: 680 }}>
          {t("home.heroSubtitle")}
        </p>

        <div className="flex gap-4 justify-center flex-wrap hero-cta">
          <Link href="/register" className="px-8 py-4 rounded-xl no-underline font-bold text-base transition-all hover:opacity-90" style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--shadow-lg)" }}>
            {t("home.ctaStart")}
          </Link>
          <a href="#how" className="px-8 py-4 rounded-xl no-underline font-semibold text-base transition-all hover:opacity-80" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
            {t("home.howItWorks")}
          </a>
        </div>

        <div className="mt-12 flex gap-8 justify-center flex-wrap hero-stats">
          {[
            { num: "20+", label: t("home.statRegisters") },
            { num: "~10 min", label: t("home.statAvgTime") },
            { num: "0-100", label: t("home.statScoreRange") },
            { num: "1 PDF", label: t("home.statReport") },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[40px] font-black leading-none" style={{ color: "var(--accent)", letterSpacing: "-0.03em" }}>{s.num}</div>
              <div className="text-[15px] mt-2 font-medium" style={{ color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
