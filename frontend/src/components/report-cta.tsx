"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";
import { trackReportCtaClick } from "@/lib/analytics";

// ═══════════════════════════════════════════════════════════════
// Unified CTA — single, strong, replaces InlineCTA1/2 + RiskTeaser + old ReportCTA
// ═══════════════════════════════════════════════════════════════

export function ReportCTA({ ico, name }: { ico: string; name: string }) {
  const t = useT();
  const { lang } = useLang();

  const benefits = [
    t("firma.ctaBenefit1"),
    t("firma.ctaBenefit2"),
    t("firma.ctaBenefit3"),
    t("firma.ctaBenefit4"),
    t("firma.ctaBenefit5"),
  ];

  const headline = t("firma.ctaHeadline", { name });
  const subheadline = t("firma.ctaSubheadline");
  const buttonLabel = t("firma.ctaButton");

  return (
    <div
      className="rounded-2xl p-6 sm:p-8 mb-6 sm:mb-8 no-print"
      style={{
        background: "linear-gradient(135deg, var(--accent-light), var(--info-bg))",
        border: "1px solid var(--accent-border)",
      }}
    >
      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {/* Left: headline + benefits */}
        <div className="flex-1">
          <h2 className="text-xl sm:text-2xl font-bold mb-2" style={{ color: "var(--text)" }}>
            {headline}
          </h2>
          <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {subheadline}
          </p>
          <ul className="space-y-2">
            {benefits.map((b, i) => (
              <li key={i} className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: price + CTA + trust */}
        <div className="sm:w-56 flex flex-col items-center text-center sm:border-l sm:pl-6 shrink-0" style={{ borderColor: "var(--accent-border)" }}>
          <div className="mb-3">
            <span className="text-3xl font-black" style={{ color: "var(--text)" }}>14 €</span>
            <span className="text-sm ml-1" style={{ color: "var(--text-muted)" }}>/ report</span>
          </div>
          <Link
            href={localizePath(`/dashboard?ico=${ico}`, lang)}
            onClick={() => trackReportCtaClick(ico, "preverte_firmu")}
            className="w-full px-6 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105 mb-4"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
          >
            {buttonLabel}
          </Link>
          <div className="space-y-1">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("firma.ctaTrust")}
            </p>
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
              {t("firma.ctaTrust2")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// FAQ — Dynamic per-company (SEO long-tail content)
// ═══════════════════════════════════════════════════════════════

type FAQProps = {
  name: string;
  ico: string;
  city?: string | null;
  legalForm?: string | null;
  foundedYear?: number | null;
  latestRevenue?: string | null;
  latestProfit?: string | null;
  latestProfitRaw?: number | null;
  latestYear?: number | null;
};

export function CompanyFAQ({ name, ico, city, legalForm, foundedYear, latestRevenue, latestProfit, latestProfitRaw, latestYear }: FAQProps) {
  const t = useT();
  const faqs: { q: string; a: string }[] = [];

  if (latestRevenue && latestYear) {
    faqs.push({
      q: t("firma.faqTrzbyQ", { name }),
      a: t("firma.faqTrzbyA", { name, year: latestYear, value: latestRevenue }),
    });
  }
  if (latestProfit && latestYear) {
    const isLoss = latestProfitRaw !== null && latestProfitRaw !== undefined && latestProfitRaw < 0;
    faqs.push({
      q: t("firma.faqHospodarskyVysledokQ", { name }),
      a: t("firma.faqHospodarskyVysledokA", { name, year: latestYear, vyrazok: isLoss ? t("firma.faqStrata") : t("firma.faqZisk"), value: latestProfit }),
    });
  }
  if (foundedYear) {
    faqs.push({
      q: t("firma.faqZalozenaQ", { name }),
      a: t("firma.faqZalozenaA", { name, year: foundedYear }),
    });
  }
  if (city) {
    faqs.push({
      q: t("firma.faqSidloQ", { name }),
      a: t("firma.faqSidloA", { name, city }),
    });
  }
  if (legalForm) {
    faqs.push({
      q: t("firma.faqPravnaFormaQ", { name }),
      a: t("firma.faqPravnaFormaA", { name, legalForm }),
    });
  }
  faqs.push({
      q: t("firma.faqIcoQ", { name }),
      a: t("firma.faqIcoA", { name, ico }),
  });

  if (faqs.length === 0) return null;

  return (
    <section className="mb-6 sm:mb-8 no-print">
      <h2 className="text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.faqTitle")} — {name}
      </h2>
      <dl className="space-y-3" itemScope itemType="https://schema.org/FAQPage">
        {faqs.map((faq, i) => (
          <div key={i} className="rounded-lg p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} itemScope itemProp="mainEntity" itemType="https://schema.org/Question">
            <dt className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }} itemProp="name">
              {faq.q}
            </dt>
            <dd className="text-xs" style={{ color: "var(--text-secondary)" }} itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
              <span itemProp="text">{faq.a}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
