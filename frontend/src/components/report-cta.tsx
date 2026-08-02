import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export function ReportCTA({ ico, name }: { ico: string; name: string }) {
  const t = useT();
  return (
    <div className="rounded-2xl p-5 sm:p-8 text-center mb-6 sm:mb-8" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))", border: "1px solid var(--accent-border)" }}>
      <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("firma.ctaTitle", { name })}
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        {t("firma.ctaDesc")}
      </p>
      <Link
        href={`/dashboard?ico=${ico}`}
        className="inline-block px-6 sm:px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
        style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(16,185,129,0.3)" }}
      >
        {t("firma.ctaButton")}
      </Link>
    </div>
  );
}
