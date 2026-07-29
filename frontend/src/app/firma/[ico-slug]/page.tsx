import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { RevenueProfitChart, AssetsEquityChart, BalanceSankeyChart } from "@/components/company-charts";
import { MetricCard, ChartCard, FinancialTable } from "@/components/firma-ui";
import Logo from "@/components/Logo";
import { slugify, parseCompanySlug } from "@/lib/slug";
import { fmtEUR, fmtYear } from "@/lib/format";
import { getCompanyData } from "@/lib/ruz";

export const dynamicParams = true;
export const revalidate = 86400;

type Params = { params: Promise<{ "ico-slug": string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) return {};

  const company = await getCompanyData(parsed.ico);
  if (!company) return {};

  const name = company.name || `IČO ${company.ico}`;
  const slug = slugify(company.name);
  const canonicalUrl = `https://verifa.sk/firma/${company.ico}-${slug}`;
  const title = `${name} (${company.ico}) – Finančné dáta, zisk, súvaha | Verifa.sk`;
  const description = `${name} (${company.ico})${company.city ? `, ${company.city}` : ""} — účtovné závierky, tržby, zisk, aktíva, Altman Z-skóre a rizikový profil z 26 Registrov SR.`;

  return {
    title, description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title, description, url: canonicalUrl, type: "website",
      locale: "sk_SK", siteName: "Verifa.sk",
      images: [{ url: "/logo-verifa.png", width: 1200, height: 630, alt: `${name} — Verifa.sk` }],
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function CompanyPage({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) notFound();

  const company = await getCompanyData(parsed.ico);
  if (!company) notFound();

  const correctSlug = slugify(company.name);
  if (parsed.slug && parsed.slug !== correctSlug) {
    redirect(`/firma/${company.ico}-${correctSlug}`);
  }

  const name = company.name || `IČO ${company.ico}`;
  const stmts = company.financialStatements;
  const latest = stmts[0];

  const chartData = [...stmts].sort((a, b) => a.year - b.year).map(s => ({
    year: s.year.toString(),
    tržby: s.mainActivityRevenue,
    zisk: s.netProfitLoss,
    aktíva: s.totalAssets,
    vlastnéImanie: s.equity,
  }));

  const balanceData = latest ? {
    cash: latest.cashAndEquivalents,
    receivables: latest.tradeReceivables,
    inventory: latest.inventory,
    currentAssets: latest.currentAssets,
    totalAssets: latest.totalAssets,
    equity: latest.equity,
    shortTermLiabilities: latest.shortTermLiabilities,
    longTermLiabilities: latest.longTermLiabilities,
  } : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `https://verifa.sk/firma/${company.ico}#organization`,
        name, identifier: company.ico,
        url: `https://verifa.sk/firma/${company.ico}-${correctSlug}`,
      },
      {
        "@type": "Dataset",
        name: `Finančné dáta — ${name}`,
        description: `Účtovné závierky pre ${name} (IČO: ${company.ico}).`,
        creator: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
        about: { "@type": "Organization", name, identifier: company.ico },
        temporalCoverage: latest ? `${latest.year}` : undefined,
      },
    ],
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
        <div className="max-w-[920px] mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
          </Link>
          <Link href="/login" className="text-sm font-medium px-4 py-2 rounded-lg transition-colors" style={{ background: "var(--accent)", color: "#fff" }}>
            Prihlásiť sa
          </Link>
        </div>
      </header>

      <div className="max-w-[920px] mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>/</span><span>Firma</span><span>/</span>
          <span style={{ color: "var(--text)" }}>{company.ico}</span>
        </div>

        {/* Company header */}
        <div className="mb-8">
          <h1 className="text-3xl font-black mb-2" style={{ color: "var(--text)" }}>{name}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <span><strong>IČO:</strong> {company.ico}</span>
            {company.legalForm && <span><strong>Právna forma:</strong> {company.legalForm}</span>}
            {company.city && (
              <span><strong>Sídlo:</strong> {company.street ? `${company.street}, ` : ""}{company.city}{company.zipCode ? `, ${company.zipCode}` : ""}</span>
            )}
            {company.establishedAt && <span><strong>Založená:</strong> {fmtYear(company.establishedAt)}</span>}
            {company.naceText && <span><strong>Predmet činnosti:</strong> {company.naceText}</span>}
          </div>
        </div>

        {/* Key metrics cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <MetricCard label="Tržby" value={fmtEUR(latest?.mainActivityRevenue)} sub={latest ? `rok ${latest.year}` : ""} color="#10b981" />
          <MetricCard
            label="Zisk / Strata"
            value={fmtEUR(latest?.netProfitLoss)}
            sub={latest ? `rok ${latest.year}` : ""}
            color={latest?.netProfitLoss !== null && latest?.netProfitLoss !== undefined && latest.netProfitLoss >= 0 ? "#10b981" : "#ef4444"}
          />
          <MetricCard label="Celkové aktíva" value={fmtEUR(latest?.totalAssets)} sub={latest ? `rok ${latest.year}` : ""} color="#3b82f6" />
          <MetricCard label="Vlastné imanie" value={fmtEUR(latest?.equity)} sub={latest ? `rok ${latest.year}` : ""} color="#8b5cf6" />
        </div>

        {/* Charts section */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ChartCard title="Tržby a zisk v čase">
              <RevenueProfitChart data={chartData} />
            </ChartCard>

            <ChartCard title="Aktíva a vlastné imanie">
              <AssetsEquityChart data={chartData} />
            </ChartCard>
          </div>
        )}

        {/* Balance sheet Sankey + Financial table */}
        {balanceData && balanceData.totalAssets && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ChartCard title="Štruktúra súvahy">
              <BalanceSankeyChart data={balanceData} />
            </ChartCard>

            <ChartCard title="Detailné finančné údaje (v tis. €)">
              <FinancialTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* CTA */}
        <div className="rounded-2xl p-8 text-center mb-8" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))", border: "1px solid var(--accent-border)" }}>
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
            Kompletný forenzný report pre {name}
          </h2>
          <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
            26 štátnych registrov, AI analýza, Altman Z-skóre, exekúcie, insolvencia — v jednom PDF za 60 sekúnd.
          </p>
          <Link
            href={`/dashboard?ico=${company.ico}`}
            className="inline-block px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
            style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(16,185,129,0.3)" }}
          >
            Vygenerovať report →
          </Link>
        </div>

        {/* SEO content */}
        <div className="mb-8" style={{ color: "var(--text-secondary)" }}>
          <h2 className="text-base font-bold mb-3" style={{ color: "var(--text)" }}>
            Finančné dáta — {name} ({company.ico})
          </h2>
          <p className="text-sm leading-relaxed mb-3">
            {name} (IČO: {company.ico}) je slovenská spoločnosť{company.city ? ` so sídlom v meste ${company.city}` : ""}
            {company.legalForm ? ` v právnej forme ${company.legalForm}` : ""}
            {company.establishedAt ? `, založená v roku ${fmtYear(company.establishedAt)}` : ""}
            {company.naceText ? `, pôsobiaca v oblasti ${company.naceText.toLowerCase()}` : ""}.
            {latest ? ` Posledné dostupné účtovné závierky sú za rok ${latest.year}.` : ""}
          </p>
          <p className="text-sm leading-relaxed mb-3">
            Verifa.sk poskytuje automatizovaný due diligence report, ktorý zhromažďuje dáta z 26+ verejných registrov
            Slovenskej republiky — vrátane ORSR, RÚZ, insolvenčného registra, registra exekúcií, RPVS a ďalších.
            Report obsahuje analýzu súvahy, výkazu ziskov a strát, Altman Z-skóre a rizikové semafóry.
          </p>
          <p className="text-sm leading-relaxed">
            {latest && latest.mainActivityRevenue !== null && `Tržby za rok ${latest.year}: ${fmtEUR(latest.mainActivityRevenue)}. `}
            {latest && latest.netProfitLoss !== null && `${latest.netProfitLoss >= 0 ? "Zisk" : "Strata"} za rok ${latest.year}: ${fmtEUR(Math.abs(latest.netProfitLoss))}. `}
            {latest && latest.totalAssets !== null && `Celkové aktíva: ${fmtEUR(latest.totalAssets)}. `}
            {latest && latest.equity !== null && `Vlastné imanie: ${fmtEUR(latest.equity)}.`}
          </p>
        </div>
      </div>
    </div>
  );
}
