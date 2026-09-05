"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";

export default function HeroSection() {
  const t = useT();
  const { lang } = useLang();

  return (
    <section className="relative overflow-hidden pt-28 pb-20 hero-pad">
      <div className="absolute -top-50 -right-25 w-125 h-125 rounded-full opacity-[0.06] blur-[80px]" style={{ background: "var(--accent)" }} />
      <div className="absolute top-25 -left-38 w-100 h-100 rounded-full opacity-[0.04] blur-[60px]" style={{ background: "var(--accent)" }} />

      <div className="relative max-w-[900px] mx-auto text-center px-6">
        <div className="inline-block px-4 py-2 rounded-full text-[12px] font-semibold mb-5" style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}>
          ⚡ {t("home.badge")}
        </div>

        <h1 className="font-black leading-[1.05] tracking-[-0.03em] mb-5" style={{ fontSize: "clamp(32px, 5vw, 50px)" }}>
          {t("home.heroTitle1")}<br /><span style={{ color: "var(--accent)" }}>{t("home.heroTitle2")}</span>
        </h1>

        <p className="text-[var(--text-secondary)] leading-relaxed mx-auto mb-8" style={{ fontSize: "clamp(15px, 2vw, 17px)", maxWidth: 620 }}>
          {t("home.heroSubtitle")}
        </p>

        <div className="mb-4 flex flex-col sm:flex-row gap-3 items-center justify-center hero-cta">
          <Link
            href={localizePath("/register", lang)}
            className="inline-block px-8 py-4 rounded-xl no-underline font-bold text-[16px] transition-all hover:opacity-90"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--shadow-lg)" }}
          >
            {t("home.heroCtaRegister")}
          </Link>
          <Link
            href={localizePath("/screener", lang)}
            className="inline-block px-6 py-4 rounded-xl no-underline font-semibold text-[15px] transition-all hover:opacity-80"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {lang === "sk" ? "Preskúmať slovenské firmy →" : lang === "de" ? "Slowakische Firmen durchsuchen →" : "Explore Slovak companies →"}
          </Link>
        </div>

        <p className="text-[13px] mb-3" style={{ color: "var(--text-muted)" }}>
          {t("home.heroHintGuest")}
        </p>

        {/* Trust badges */}
        <div className="flex gap-5 justify-center flex-wrap mb-9 text-[12px]" style={{ color: "var(--text-muted)" }}>
          <span className="flex items-center gap-1.5">
            <span style={{ color: "var(--accent)" }}>✓</span> {t("home.trustGdpr")}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ color: "var(--accent)" }}>✓</span> {t("home.trustNoCommitment")}
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ color: "var(--accent)" }}>✓</span> {t("home.trustFreeReport")}
          </span>
        </div>

        <div className="mt-8 flex gap-8 justify-center flex-wrap hero-stats">
          {[
            { num: "25+", label: t("home.statRegisters") },
            { num: "~10-15 min", label: t("home.statAvgTime") },
            { num: "0-100", label: t("home.statScoreRange") },
            { num: "1 PDF", label: t("home.statReport") },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[30px] font-black leading-none hero-stat-num" style={{ color: "var(--accent)", letterSpacing: "-0.03em" }}>{s.num}</div>
              <div className="text-[13px] mt-1.5 font-medium" style={{ color: "var(--text-secondary)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
