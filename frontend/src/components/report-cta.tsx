"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";

export function ReportCTA({ ico, name }: { ico: string; name: string }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className="rounded-2xl p-5 sm:p-8 text-center mb-6 sm:mb-8" style={{ background: "linear-gradient(135deg, var(--accent-light), var(--info-bg))", border: "1px solid var(--accent-border)" }}>
      <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("firma.ctaTitle", { name })}
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        {t("firma.ctaDesc")}
      </p>
      <Link
        href={localizePath(`/dashboard?ico=${ico}`, lang)}
        className="inline-block px-6 sm:px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
        style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
      >
        {t("firma.ctaButton")}
      </Link>
    </div>
  );
}
