"use client";

import Link from "next/link";
import { useT, useLang } from "@/components/LanguageProvider";
import { localizePath } from "@/lib/i18n";

// ═══════════════════════════════════════════════════════════════
// CTA #1 — Inline after MetricCards (subtle, contextual)
// ═══════════════════════════════════════════════════════════════

export function InlineCTA1({ ico }: { ico: string }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className="rounded-xl p-4 mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3 no-print" style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}>
      <div className="flex-1">
        <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--text)" }}>
          {t("firma.inlineCta1Title")}
        </p>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {t("firma.inlineCta1Desc")}
        </p>
      </div>
      <Link
        href={localizePath(`/dashboard?ico=${ico}`, lang)}
        className="shrink-0 px-4 py-2 rounded-lg font-semibold text-xs transition-all hover:scale-105"
        style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
      >
        {t("firma.inlineCta1Button")}
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CTA #2 — After financial tables (risk-focused)
// ═══════════════════════════════════════════════════════════════

export function InlineCTA2({ ico }: { ico: string }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className="rounded-xl p-4 sm:p-5 mb-6 sm:mb-8 no-print" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
            {t("firma.inlineCta2Title")}
          </p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {t("firma.inlineCta2Desc")}
          </p>
        </div>
        <Link
          href={localizePath(`/dashboard?ico=${ico}`, lang)}
          className="shrink-0 px-5 py-2.5 rounded-lg font-semibold text-xs transition-all hover:scale-105"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
        >
          {t("firma.inlineCta2Button")}
        </Link>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Risk Teaser — Locked card (no fake score)
// ═══════════════════════════════════════════════════════════════

export function RiskTeaser({ ico }: { ico: string }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className="rounded-2xl p-5 sm:p-6 mb-6 sm:mb-8 relative overflow-hidden no-print" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg" style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--warning)" }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>
            {t("firma.riskTeaserTitle")}
          </h3>
          <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--text-muted)" }}>
            {t("firma.riskTeaserDesc")}
          </p>
          <Link
            href={localizePath(`/dashboard?ico=${ico}`, lang)}
            className="inline-block px-4 py-2 rounded-lg font-semibold text-xs transition-all hover:scale-105"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
          >
            {t("firma.riskTeaserButton")}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CTA #3 — Full card at end (existing, enhanced with benefits)
// ═══════════════════════════════════════════════════════════════

export function ReportCTA({ ico, name }: { ico: string; name: string }) {
  const t = useT();
  const { lang } = useLang();
  const benefits = [
    "26+ verejných registrov SR",
    "Nedoplatky, exekúcie, insolvencia",
    "Vlastnícka štruktúra a RPVS",
    "Finančné red flags a AI analýza",
    "Kompletný PDF report",
  ];
  return (
    <div className="rounded-2xl p-5 sm:p-8 text-center mb-6 sm:mb-8" style={{ background: "linear-gradient(135deg, var(--accent-light), var(--info-bg))", border: "1px solid var(--accent-border)" }}>
      <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("firma.ctaTitle")}
      </h2>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
        {t("firma.ctaDesc")}
      </p>
      <ul className="text-xs text-left inline-block mb-5 space-y-1.5" style={{ color: "var(--text-secondary)" }}>
        {benefits.map((b, i) => (
          <li key={i} className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)", flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
            {b}
          </li>
        ))}
      </ul>
      {/* Price + CTA */}
      <div className="mb-4">
        <span className="text-2xl font-black" style={{ color: "var(--text)" }}>14 €</span>
        <span className="text-sm ml-1" style={{ color: "var(--text-muted)" }}>/ report</span>
      </div>
      <div>
        <Link
          href={localizePath(`/dashboard?ico=${ico}`, lang)}
          className="inline-block px-6 sm:px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
        >
          {lang === "sk" ? "Preveriť túto firmu →" : lang === "de" ? "Dieses Unternehmen prüfen →" : "Verify this company →"}
        </Link>
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("firma.ctaTrust")}
        </p>
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("firma.ctaTrust2")}
        </p>
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
  latestYear?: number | null;
};

export function CompanyFAQ({ name, ico, city, legalForm, foundedYear, latestRevenue, latestProfit, latestYear }: FAQProps) {
  const t = useT();
  const faqs: { q: string; a: string }[] = [];

  if (latestRevenue && latestYear) {
    faqs.push({
      q: `Aké má ${name} tržby?`,
      a: `${name} dosiahla v roku ${latestYear} tržby vo výške ${latestRevenue}.`,
    });
  }
  if (latestProfit && latestYear) {
    faqs.push({
      q: `Aký bol zisk ${name}?`,
      a: `Čistý zisk (resp. strata) spoločnosti ${name} za rok ${latestYear} bol ${latestProfit}.`,
    });
  }
  if (foundedYear) {
    faqs.push({
      q: `Kedy bola ${name} založená?`,
      a: `Spoločnosť ${name} bola založená v roku ${foundedYear}.`,
    });
  }
  if (city) {
    faqs.push({
      q: `Kde sídli ${name}?`,
      a: `${name} má registrované sídlo v meste ${city}.`,
    });
  }
  if (legalForm) {
    faqs.push({
      q: `Aká je právna forma ${name}?`,
      a: `Právna forma spoločnosti ${name} je ${legalForm}.`,
    });
  }
  faqs.push({
    q: `Aké je IČO ${name}?`,
    a: `IČO spoločnosti ${name} je ${ico}.`,
  });

  if (faqs.length === 0) return null;

  return (
    <section className="mb-6 sm:mb-8 no-print">
      <h2 className="text-base font-bold mb-3" style={{ color: "var(--text)" }}>
        {t("firma.faqTitle")} o {name}
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
