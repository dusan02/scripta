import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { RevenueProfitChart, BalanceSankeyChart } from "@/components/company-charts";
import { MetricCard, ChartCard, BalanceSheetTable, ProfitLossTable, FinancialRatios } from "@/components/firma-ui";
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
import { getServerSession } from "@/lib/auth";
import { getLangFromHeaders, generateFirmaMetadata } from "@/lib/seo";
import { RelatedFirms } from "@/components/related-firms";
import { VestnikEvents } from "@/components/vestnik-events";
import { CompanyEvents } from "@/components/company-events";

export const dynamicParams = true;
export const revalidate = 86400;

type Params = { params: Promise<{ "ico-slug": string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) return {};

  const company = await getCompanyData(parsed.ico);
  if (!company) return { robots: { index: false, follow: false } };

  const h = await headers();
  const lang = getLangFromHeaders(h);
  const name = company.name || `IČO ${company.ico}`;

  // Quality gate: index only firms with ≥2 years of financial data
  const stmtCount = company.financialStatements.length;
  if (stmtCount < 2) {
    return {
      ...generateFirmaMetadata(name, company.ico, company.city || null, lang),
      robots: { index: false, follow: true },
    };
  }

  return generateFirmaMetadata(name, company.ico, company.city || null, lang);
}

export default async function CompanyPage({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) notFound();

  const company = await getCompanyData(parsed.ico);
  if (!company) notFound();

  const session = await getServerSession();
  const isLoggedIn = !!session?.user?.id;

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
            {isLoggedIn ? (
              <Link href="/dashboard" className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                Dashboard
              </Link>
            ) : (
              <Link href="/login" className="text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors" style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                Prihlásiť sa
              </Link>
            )}
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

        {/* Source attribution + freshness — prominent status for konkurz/likvidácia */}
        {(() => {
          const hasKonkurz = company.vestnikEvents?.some((e: any) => e.eventType?.toLowerCase().includes("konkurz"));
          const hasLikvidacia = company.vestnikEvents?.some((e: any) => e.eventType?.toLowerCase().includes("likvid"));
          return (
            <div className="mb-4">
              {hasKonkurz && (
                <div className="rounded-lg p-3 mb-2" style={{ background: "var(--danger-bg, #fef2f2)", border: "1px solid var(--danger-border, #fecaca)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--danger, #dc2626)" }}>
                    Firma je v konkurze. Zdroj: Obchodný vestník.
                  </p>
                </div>
              )}
              {hasLikvidacia && !hasKonkurz && (
                <div className="rounded-lg p-3 mb-2" style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #fde68a)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--warning, #d97706)" }}>
                    Firma je v likvidácii. Zdroj: Obchodný vestník.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {["ORSR", "RÚZ", "Obchodný vestník"].map(src => (
                  <span key={src} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{src}</span>
                ))}
                {latest?.year && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>Závierka {latest.year}</span>
                )}
                {company.sizeCategory && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>Veľkosť firmy: {company.sizeCategory}</span>
                )}
                {company.employeeCount != null && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>Zamestnanci: {company.employeeCount}</span>
                )}
                {company.ownershipType && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{company.ownershipType}</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Key metrics cards — first screening */}
        {stmts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
            <MetricCard label="Tržby" value={fmtEUR(latest?.mainActivityRevenue)} sub={latest ? `rok ${latest.year}` : ""} color="#3b82f6" trend={trends.revenue} />
            <MetricCard
              label="Zisk / Strata"
              value={fmtEUR(latest?.netProfitLoss)}
              sub={latest ? `rok ${latest.year}` : ""}
              color="#10b981"
              trend={trends.profit}
            />
            <MetricCard label="Celkové aktíva" value={fmtEUR(latest?.totalAssets)} sub={latest ? `rok ${latest.year}` : ""} color="#8b5cf6" trend={trends.assets} />
            <MetricCard label="Vlastné imanie" value={fmtEUR(latest?.equity)} sub={latest ? `rok ${latest.year}` : ""} color="#f59e0b" trend={trends.equity} />
          </div>
        ) : (
          <div className="rounded-lg p-4 mb-6 sm:mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
              Finančné údaje nie sú dostupné
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              V RÚZ nemáme dostupnú účtovnú závierku pre túto firmu.
            </p>
          </div>
        )}

        {/* Trends + Persons side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 sm:mb-6">
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
            vestnikEvents: company.vestnikEvents,
          })} />

          <CompanyPersons persons={persons} />
        </div>

        {/* Vestník events — zdroj: Obchodný vestník SR */}
        {company.vestnikEvents && company.vestnikEvents.length > 0 && (
          <VestnikEvents events={company.vestnikEvents as any} />
        )}

        {/* Company events — zdroj: ORSR, Vestník (verejné registre) */}
        {company.companyEvents && company.companyEvents.length > 0 && (
          <CompanyEvents events={company.companyEvents as any} />
        )}


        {/* Balance Sheet section — chart left, table right */}
        {balanceData && balanceData.totalAssets != null && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8">
            <ChartCard title="Štruktúra súvahy">
              <BalanceSankeyChart data={balanceData} />
            </ChartCard>
            <ChartCard title="Súvaha (v tis. €)">
              <BalanceSheetTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* Profit and Loss section — chart left, table right */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8">
            <ChartCard title="Tržby a zisk v čase">
              <RevenueProfitChart data={chartData} />
            </ChartCard>
            <ChartCard title="Výkaz ziskov a strát (v tis. €)">
              <ProfitLossTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* Financial ratios — indebtedness & current liquidity */}
        {stmts.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <ChartCard title="Finančné ukazovatele">
              <FinancialRatios stmts={stmts} />
            </ChartCard>
          </div>
        )}

        <ReportCTA ico={company.ico} name={name} />

        {/* Internal linking: related firms by city and industry */}
        <RelatedFirms ico={company.ico} city={company.city} naceCode={company.naceCode} />
      </div>
    </div>
  );
}
