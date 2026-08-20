"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";

export default function ScreenerCtaSection() {
  const t = useT();
  const { lang } = useLang();

  return (
    <section className="section-pad">
      <div className="max-w-[800px] mx-auto px-6">
        <div
          className="rounded-2xl p-8 sm:p-12 text-center"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div
            className="inline-block px-4 py-2 rounded-full text-[12px] font-semibold mb-4"
            style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)", color: "var(--accent)" }}
          >
            🔍 {lang === "sk" ? "Databáza firiem" : "Company database"}
          </div>

          <h2 className="font-black leading-tight mb-3" style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}>
            {lang === "sk" ? "Preskúmajte slovenské firmy" : "Explore Slovak companies"}
          </h2>

          <p className="text-[var(--text-secondary)] leading-relaxed mb-6 mx-auto" style={{ fontSize: "clamp(14px, 2vw, 16px)", maxWidth: 520 }}>
            {lang === "sk"
              ? "Vyhľadávajte a filtrujte 500 000+ slovenských spoločností podľa odvetvia, kraja, finančných ukazovateľov a ďalších kritérií."
              : "Search and filter 500,000+ Slovak companies by industry, region, financial indicators and more."}
          </p>

          <Link
            href={localizePath("/screener", lang)}
            className="inline-block px-8 py-3.5 rounded-xl no-underline font-bold text-[15px] transition-all hover:opacity-90"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
          >
            {lang === "sk" ? "Otvoriť screener →" : "Open screener →"}
          </Link>
        </div>
      </div>
    </section>
  );
}
