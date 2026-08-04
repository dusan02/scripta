import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { RevenueProfitChart, BalanceSankeyChart } from "@/components/company-charts";
import { MetricCard, ChartCard, BalanceSheetTable, ProfitLossTable } from "@/components/firma-ui";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { CompanyHeader } from "@/components/company-header";
import { CompanyPersons } from "@/components/company-persons";
import { ReportCTA } from "@/components/report-cta";
import { CompanyInsights } from "@/components/company-insights";
import { slugify, parseCompanySlug } from "@/lib/slug";
import { fmtEUR, num } from "@/lib/format";
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
  const canonicalUrl = `https://verifa.sk/firma/${company.ico}`;
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

  const persons = company.companyPersons ?? [];

  if (parsed.slug) {
    redirect(`/firma/${company.ico}`);
  }

  const name = company.name || `IČO ${company.ico}`;
  const stmts = company.financialStatements;
  const latest = stmts[0];
  const prev = stmts[1];

  const trends = {
    revenue: calcTrend(num(latest?.mainActivityRevenue), num(prev?.mainActivityRevenue)),
    profit: calcTrend(num(latest?.netProfitLoss), num(prev?.netProfitLoss)),
    assets: calcTrend(num(latest?.totalAssets), num(prev?.totalAssets)),
    equity: calcTrend(num(latest?.equity), num(prev?.equity)),
  };

  const chartData = [...stmts].sort((a, b) => a.year - b.year).map(s => ({
    year: s.year.toString(),
    tržby: num(s.mainActivityRevenue),
    zisk: num(s.netProfitLoss),
    daň: num(s.incomeTax),
    aktíva: num(s.totalAssets),
    vlastnéImanie: num(s.equity),
  }));

  const balanceData = latest ? {
    currentAssets: num(latest.currentAssets),
    totalAssets: num(latest.totalAssets),
    equity: num(latest.equity),
    shortTermLiabilities: num(latest.shortTermLiabilities),
    longTermLiabilities: num(latest.longTermLiabilities),
  } : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `https://verifa.sk/firma/${company.ico}#organization`,
        name, identifier: company.ico,
        url: `https://verifa.sk/firma/${company.ico}`,
      },
      {
        "@type": "Dataset",
        name: `Finančné dáta — ${name}`,
        description: `Účtovné závierky pre ${name} (IČO: ${company.ico}).`,
        creator: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
        about: { "@type": "Organization", name, identifier: company.ico },
        temporalCoverage: latest ? `${latest.year}` : undefined,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Verifa.sk", item: "https://verifa.sk" },
          { "@type": "ListItem", position: 2, name, item: `https://verifa.sk/firma/${company.ico}` },
        ],
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
            <ThemeToggle size="sm" />
            <Link
              href={`/dashboard?ico=${company.ico}`}
              className="text-xs sm:text-sm font-bold px-3 sm:px-4 py-2 rounded-lg transition-all hover:scale-105"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
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

        <CompanyInsights insights={generateCompanyInsights(stmts.map(s => ({
          year: s.year,
          mainActivityRevenue: num(s.mainActivityRevenue),
          netProfitLoss: num(s.netProfitLoss),
          totalAssets: num(s.totalAssets),
          equity: num(s.equity),
          grossProfit: num(s.grossProfit),
          staffCosts: num(s.staffCosts),
          depreciation: num(s.depreciation),
          incomeTax: num(s.incomeTax),
          shortTermLiabilities: num(s.shortTermLiabilities),
          longTermLiabilities: num(s.longTermLiabilities),
          currentAssets: num(s.currentAssets),
          cashAndEquivalents: num(s.cashAndEquivalents),
        })), {
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
            color={latest?.netProfitLoss !== null && latest?.netProfitLoss !== undefined && num(latest.netProfitLoss)! >= 0 ? "#10b981" : "#ef4444"}
            trend={trends.profit}
          />
          <MetricCard label="Celkové aktíva" value={fmtEUR(latest?.totalAssets)} sub={latest ? `rok ${latest.year}` : ""} color="#3b82f6" trend={trends.assets} />
          <MetricCard label="Vlastné imanie" value={fmtEUR(latest?.equity)} sub={latest ? `rok ${latest.year}` : ""} color="#8b5cf6" trend={trends.equity} />
        </div>

        <CompanyPersons persons={persons} />

        {/* No financial data fallback */}
        {stmts.length === 0 && (
          <div className="rounded-2xl p-6 sm:p-8 text-center mb-6 sm:mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Pre túto spoločnosť zatiaľ nie sú k dispozícii účtovné závierky z registra RÚZ.
              Môžete vygenerovať full report, ktorý čerpá dáta z 26 registrov SR.
            </p>
          </div>
        )}

        {/* Balance Sheet section */}
        {balanceData && balanceData.totalAssets != null && (
          <div className="mb-8">
            <div className="mb-4">
              <ChartCard title="Štruktúra súvahy">
                <BalanceSankeyChart data={balanceData} />
              </ChartCard>
            </div>
            <ChartCard title="Súvaha (v tis. €)">
              <BalanceSheetTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* Profit and Loss section */}
        {chartData.length > 0 && (
          <div className="mb-8">
            <div className="mb-4">
              <ChartCard title="Tržby a zisk v čase">
                <RevenueProfitChart data={chartData} />
              </ChartCard>
            </div>
            <ChartCard title="Výkaz ziskov a strát (v tis. €)">
              <ProfitLossTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        <ReportCTA ico={company.ico} name={name} />
      </div>
    </div>
  );
}
