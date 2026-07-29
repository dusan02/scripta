import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { RevenueProfitChart, BalanceSankeyChart } from "@/components/company-charts";
import { MetricCard, ChartCard, BalanceSheetTable, ProfitLossTable } from "@/components/firma-ui";
import Logo from "@/components/Logo";
import { CompanyHeader } from "@/components/company-header";
import { CompanyPersons } from "@/components/company-persons";
import { ReportCTA } from "@/components/report-cta";
import { CompanyInsights } from "@/components/company-insights";
import { slugify, parseCompanySlug } from "@/lib/slug";
import { fmtEUR } from "@/lib/format";
import { calcTrend } from "@/lib/trend";
import { generateCompanyInsights } from "@/lib/company-insights";
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
  const title = `${name} (${company.ico}) – Finančné dáta, zisk, súvaha`;
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

  const persons: Array<{ id: string; rawName: string; role: string; city: string | null; zipCode: string | null }> =
    (company as any).companyPersons ?? [];

  const correctSlug = slugify(company.name);
  if (parsed.slug && parsed.slug !== correctSlug) {
    redirect(`/firma/${company.ico}-${correctSlug}`);
  }

  const name = company.name || `IČO ${company.ico}`;
  const stmts = company.financialStatements;
  const latest = stmts[0];
  const prev = stmts[1];

  const trends = {
    revenue: calcTrend(latest?.mainActivityRevenue, prev?.mainActivityRevenue),
    profit: calcTrend(latest?.netProfitLoss, prev?.netProfitLoss),
    assets: calcTrend(latest?.totalAssets, prev?.totalAssets),
    equity: calcTrend(latest?.equity, prev?.equity),
  };

  const chartData = [...stmts].sort((a, b) => a.year - b.year).map(s => ({
    year: s.year.toString(),
    tržby: s.mainActivityRevenue,
    zisk: s.netProfitLoss,
    daň: s.incomeTax,
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
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard?ico=${company.ico}`}
              className="text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 rounded-lg transition-all hover:scale-105"
              style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" }}
            >
              Report →
            </Link>
            <Link href="/login" className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
              Prihlásiť sa
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs sm:text-sm mb-4" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>/</span><span>Firma</span><span>/</span>
          <span style={{ color: "var(--text)" }}>{name}</span>
        </div>

        <CompanyHeader company={company} latestYear={latest?.year} />

        <CompanyInsights insights={generateCompanyInsights(stmts, {
          forensicRedFlags: (company.auditVerdict as any)?.forensicRedFlags,
          vestnikEvents: company.vestnikEvents,
        })} />

        {/* Key metrics cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-6 sm:mb-8">
          <MetricCard label="Tržby" value={fmtEUR(latest?.mainActivityRevenue)} sub={latest ? `rok ${latest.year}` : ""} color="#3b82f6" trend={trends.revenue} />
          <MetricCard
            label="Zisk / Strata"
            value={fmtEUR(latest?.netProfitLoss)}
            sub={latest ? `rok ${latest.year}` : ""}
            color={latest?.netProfitLoss !== null && latest?.netProfitLoss !== undefined && latest.netProfitLoss >= 0 ? "#10b981" : "#ef4444"}
            trend={trends.profit}
          />
          <MetricCard label="Celkové aktíva" value={fmtEUR(latest?.totalAssets)} sub={latest ? `rok ${latest.year}` : ""} color="#3b82f6" trend={trends.assets} />
          <MetricCard label="Vlastné imanie" value={fmtEUR(latest?.equity)} sub={latest ? `rok ${latest.year}` : ""} color="#8b5cf6" trend={trends.equity} />
        </div>

        <CompanyPersons persons={persons} />

        {/* Balance Sheet section */}
        {balanceData && balanceData.totalAssets && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">
            <div className="lg:col-span-3">
              <ChartCard title="Štruktúra súvahy">
                <BalanceSankeyChart data={balanceData} />
              </ChartCard>
            </div>
            <div className="lg:col-span-2 overflow-hidden">
              <ChartCard title="Súvaha (v tis. €)">
                <BalanceSheetTable stmts={stmts} />
              </ChartCard>
            </div>
          </div>
        )}

        {/* Profit and Loss section */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">
            <div className="lg:col-span-3">
              <ChartCard title="Tržby a zisk v čase">
                <RevenueProfitChart data={chartData} />
              </ChartCard>
            </div>
            <div className="lg:col-span-2 overflow-hidden">
              <ChartCard title="Výkaz ziskov a strát (v tis. €)">
                <ProfitLossTable stmts={stmts} />
              </ChartCard>
            </div>
          </div>
        )}

        <ReportCTA ico={company.ico} name={name} />

        {/* SEO content */}
        <div className="mb-6 sm:mb-8" style={{ color: "var(--text-secondary)" }}>
          <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
            Finančné dáta — {name} ({company.ico})
          </h2>
          <p className="text-sm leading-relaxed mb-3">
            {name} ({company.ico}){company.city ? ` so sídlom v ${company.city}` : ""}
            {company.legalForm ? ` v právnej forme ${company.legalForm}` : ""}
            {company.establishedAt ? `, založená v roku ${new Date(company.establishedAt).getFullYear()}` : ""}
            {company.naceText ? `. Hlavná činnosť: ${company.naceText}.` : ""}
            {" "}Verifa.sk poskytuje automatizovaný due diligence report z 26+ verejných registrov SR — ORSR, RÚZ,"
            {" "}insolvenčný register, register exekúcií, RPVS a ďalšie. Report obsahuje analýzu súvahy,"
            {" "}výkazu ziskov a strát, Altman Z-skóre a rizikové semafóry."
          </p>
        </div>

        {/* Footer */}
        <footer className="border-t pt-6 pb-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
            <div className="flex items-center gap-2">
              <Logo size="sm" />
              <span>© {new Date().getFullYear()} Verifa.sk</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="hover:underline">Cenník</Link>
              <Link href="/register" className="hover:underline">Register</Link>
              <Link href="/terms" className="hover:underline">Podmienky</Link>
              <a href="mailto:info@verifa.sk" className="hover:underline">info@verifa.sk</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
