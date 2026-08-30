import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MetricCard, ChartCard, BalanceSheetTable, ProfitLossTable, CashFlowTable, RentabilityRatios, StabilityRatios } from "@/components/firma-ui";

// Charts stay SSR'd (SVG in HTML for SEO) but the ~380 kB Recharts bundle is
// split out of the initial page JS and loaded lazily at hydration time.
const RevenueProfitChart = dynamic(() => import("@/components/company-charts").then(m => m.RevenueProfitChart));
const BalanceSankeyChart = dynamic(() => import("@/components/company-charts").then(m => m.BalanceSankeyChart));
const RentabilityChart = dynamic(() => import("@/components/financial-indicators-charts").then(m => m.RentabilityChart));
const StabilityChart = dynamic(() => import("@/components/financial-indicators-charts").then(m => m.StabilityChart));
import { ExtendedRatios, EmployeeTrend } from "@/components/extended-ratios";
import { PiotroskiCard } from "@/components/piotroski-card";
import { computeFinancialIndicators } from "@/lib/financial-indicators";
import { computePiotroski } from "@/lib/piotroski";
import { computeRiskSignals } from "@/lib/risk-signals";
import { generateFinancialSummary } from "@/lib/financial-summary";
import { FirmaStickyHeader } from "@/components/firma-sticky-header";
import { CompanyHeader } from "@/components/company-header";
import { CompanyPersons } from "@/components/company-persons";
import { BusinessActivitySection, SigningAuthoritySection } from "@/components/company-business-activity";
import { RiskSignals } from "@/components/risk-signals";
import { DataSourcesSection } from "@/components/data-sources";
import { ReportCTA, CompanyFAQ, InlineReportCTA } from "@/components/report-cta";
import { parseCompanySlug } from "@/lib/slug";
import { fmtEUR, num } from "@/lib/format";
import { calcTrend } from "@/lib/trend";
import { getCompanyData } from "@/lib/ruz";
import { generateFirmaMetadata, getCanonicalUrl } from "@/lib/seo";
import { translate, type Lang } from "@/lib/i18n";
import { RelatedFirms } from "@/components/related-firms";
import { CrossFirmPersons, getCrossFirmPersons } from "@/components/cross-firm-persons";
import { VestnikEvents } from "@/components/vestnik-events";
import { CompanyEvents } from "@/components/company-events";
import { FirmaPageTracker } from "@/components/firma-page-tracker";

// ─── Shared firma page — rendered by static route groups ───
// app/(pub)/firma/[ico-slug]        → lang "sk"
// app/(pub-{en,de,cs,hu,pl})/{prefix}/firma/[ico-slug] → respective lang
// Language comes from the URL route (not headers/cookies), so these pages
// are fully static + ISR-cacheable (revalidate = 86400).

export async function generateFirmaPageMetadata(icoSlug: string, lang: Lang): Promise<Metadata> {
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) return {};

  const company = await getCompanyData(parsed.ico);
  if (!company) {
    // Company not in DB — return noindex + canonical to self (not homepage)
    // notFound() in the page may be swallowed by Sentry, so we must set canonical here
    const slug = parsed.slug || "firma";
    const firmaPath = `/firma/${parsed.ico}-${slug}`;
    return {
      robots: { index: false, follow: false },
      alternates: {
        canonical: getCanonicalUrl(firmaPath, lang),
      },
    };
  }

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

export async function FirmaPageContent({ icoSlug, lang }: { icoSlug: string; lang: Lang }) {
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) notFound();

  const company = await getCompanyData(parsed.ico);
  if (!company) notFound();

  const t = (key: string, params?: Record<string, string | number>) => translate(lang, key, params);

  const persons = company.companyPersons ?? [];

  // SEO: slug validation + 308 redirect is handled in middleware.ts
  // (permanentRedirect() in page.tsx is swallowed by Sentry's wrapServerComponentWithSentry)
  // Middleware uses NextResponse.redirect(308) which bypasses Sentry.

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

  // Use the most recent year that has totalAssets for the Sankey chart
  const balanceStmt = stmts.find(s => num(s.totalAssets) != null) ?? null;
  const balanceData = balanceStmt ? {
    currentAssets: num(balanceStmt.currentAssets),
    nonCurrentAssets: num(balanceStmt.nonCurrentAssets),
    totalAssets: num(balanceStmt.totalAssets),
    equity: num(balanceStmt.equity),
    shortTermLiabilities: num(balanceStmt.shortTermLiabilities),
    longTermLiabilities: num(balanceStmt.longTermLiabilities),
    intangibleAssets: num(balanceStmt.intangibleAssets),
    tangibleAssets: num(balanceStmt.tangibleAssets),
    ltFinancialAssets: num(balanceStmt.ltFinancialAssets),
    ltReceivables: num(balanceStmt.ltReceivables),
    inventory: num(balanceStmt.inventory),
    tradeReceivables: num(balanceStmt.tradeReceivables),
    stFinancialAssets: num(balanceStmt.stFinancialAssets),
    cashAndEquivalents: num(balanceStmt.cashAndEquivalents),
    deferredAssets: num(balanceStmt.deferredAssets),
    shareCapital: num(balanceStmt.shareCapital),
    sharePremium: num(balanceStmt.sharePremium),
    otherCapitalFunds: num(balanceStmt.otherCapitalFunds),
    statutoryReserveFunds: num(balanceStmt.statutoryReserveFunds),
    retainedEarnings: num(balanceStmt.retainedEarnings),
    currentYearProfit: num(balanceStmt.currentYearProfit),
    ltReserves: num(balanceStmt.ltReserves),
    stReserves: num(balanceStmt.stReserves),
    stBankLoans: num(balanceStmt.stBankLoans),
    stFinancialAssistance: num(balanceStmt.stFinancialAssistance),
    tradePayables: num(balanceStmt.tradePayables),
    socialInsuranceLiabilities: num(balanceStmt.socialInsuranceLiabilities),
    taxLiabilities: num(balanceStmt.taxLiabilities),
    employeeLiabilities: num(balanceStmt.employeeLiabilities),
  } : null;

  const orgSchema: Record<string, any> = {
    "@type": "Organization",
    "@id": `https://verifa.sk/firma/${company.ico}#organization`,
    name,
    legalName: company.name || undefined,
    identifier: { "@type": "PropertyValue", name: "IČO", value: company.ico },
    taxID: company.ico,
    url: `https://verifa.sk/firma/${company.ico}`,
  };

  if (company.establishedAt) {
    orgSchema.foundingDate = company.establishedAt.toISOString().split("T")[0];
  }
  if (company.ruzDissolutionDate) {
    orgSchema.dissolutionDate = company.ruzDissolutionDate.toISOString().split("T")[0];
  }
  if (company.city || company.street || company.zipCode) {
    orgSchema.address = {
      "@type": "PostalAddress",
      addressCountry: "SK",
      ...(company.city ? { addressLocality: company.city } : {}),
      ...(company.kraj ? { addressRegion: company.kraj } : {}),
      ...(company.street ? { streetAddress: company.street } : {}),
      ...(company.zipCode ? { postalCode: company.zipCode } : {}),
    };
  }
  if (company.naceText) {
    orgSchema.knowsAbout = company.naceText;
  }
  if (company.legalForm) {
    orgSchema.additionalType = company.legalForm;
  }
  if (latest && latest.employeeCount != null) {
    orgSchema.numberOfEmployees = { "@type": "QuantitativeValue", value: latest.employeeCount };
  }

  // Dataset schema for Google Dataset Search (financial statements)
  const datasetSchema: Record<string, any> | null = stmts.length >= 2 ? {
    "@type": "Dataset",
    name: `Finančné výkazy — ${name} (${company.ico})`,
    description: `Účtovné závierky spoločnosti ${name} (IČO: ${company.ico}) za roky ${stmts[stmts.length - 1]?.year}–${latest?.year}. Zdroj: Register účtovných závierok SR (RÚZ).`,
    url: `https://verifa.sk/firma/${company.ico}`,
    temporalCoverage: `${stmts[stmts.length - 1]?.year}/${latest?.year}`,
    creator: { "@type": "Organization", name: "Register účtovných závierok SR", url: "https://registeruz.sk" },
    license: "https://data.gov.sk/def/ontology/law/License/opendata",
    distribution: {
      "@type": "DataDownload",
      encodingFormat: "text/html",
      contentUrl: `https://verifa.sk/firma/${company.ico}`,
    },
  } : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      orgSchema,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Verifa.sk", item: "https://verifa.sk" },
          { "@type": "ListItem", position: 2, name: t("firma.breadcrumbFirma"), item: "https://verifa.sk/firmy" },
          { "@type": "ListItem", position: 3, name, item: `https://verifa.sk/firma/${company.ico}` },
        ],
      },
      ...(datasetSchema ? [datasetSchema] : []),
    ],
  };

  // ── Risk signals (i18n'd, unit-tested in lib/risk-signals.ts) ──
  const signals = computeRiskSignals(company, latest, lang);
  const riskCount = signals.length;

  // ── Cross-firm persons — fetch links for deduplication ──
  const crossFirmLinks = await getCrossFirmPersons(company.ico);
  const crossFirmIcos = crossFirmLinks.map(f => f.ico);

  // ── Financial Summary — 1-2 sentence narrative (i18n'd in lib/financial-summary.ts) ──
  const financialSummary = generateFinancialSummary(name, latest, prev, lang);

  // ── Data sources for collapsible section ──
  const dataSources: Array<{ name: string; syncedAt: Date | null; dataRange?: string | null }> = [];
  if (company.companyPersons && company.companyPersons.length > 0) {
    dataSources.push({
      name: "Obchodný register SR (ORSR)",
      syncedAt: company.orsrSyncedAt ?? null,
    });
  }
  if (stmts.length > 0) {
    const years = stmts.map(s => s.year).sort();
    dataSources.push({
      name: "Register účtovných závierok (RÚZ)",
      syncedAt: company.ruzSyncedAt ?? null,
      dataRange: years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : String(years[0]),
    });
  }
  if (company.vestnikEvents && company.vestnikEvents.length > 0) {
    dataSources.push({
      name: "Obchodný vestník SR",
      syncedAt: company.vestnikSyncedAt ?? null,
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <FirmaPageTracker ico={company.ico} hasRiskSignals={riskCount > 0} riskCount={riskCount} />

      {/* ── STICKY HEADER — logo + compact primary CTA (hidden client-side for logged-in users) ── */}
      <FirmaStickyHeader ico={company.ico} />

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs sm:text-sm mb-4 no-print" style={{ color: "var(--text-muted)" }}>
          <Link href="/" className="hover:underline">Verifa.sk</Link>
          <span>/</span><Link href="/firmy" className="hover:underline">{t("firma.breadcrumbFirma")}</Link><span>/</span>
          <span style={{ color: "var(--text)" }}>{name}</span>
        </div>

        <CompanyHeader
          company={{
            ...company,
            shareCapital: company.shareCapital != null ? Number(company.shareCapital) : null,
          }}
          latestYear={latest?.year}
          riskCount={riskCount}
        />

        {/* Print-only header with logo — fixed to appear on every page */}
        <div className="print-only-logo">
          <img src="/logo-verifa.png" alt="Verifa.sk" width="118" height="40" />
        </div>

        {/* Print-only footer — consistent on every page */}
        <div className="print-only-footer">
          <span>© 2026 Verifa.sk</span>
          <span>Business risk report</span>
        </div>

        {/* ── KEY FACTS — merged source attribution + provenance into one row ── */}
        {(() => {
          const hasKonkurz = company.vestnikEvents?.some((e: any) => e.eventType?.toLowerCase().includes("konkurz"));
          const hasLikvidacia = company.vestnikEvents?.some((e: any) => e.eventType?.toLowerCase().includes("likvid"));
          return (
            <div className="mb-4 no-print">
              {hasKonkurz && (
                <div className="rounded-lg p-3 mb-2" style={{ background: "var(--danger-bg, #fef2f2)", border: "1px solid var(--danger-border, #fecaca)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--danger, #dc2626)" }}>
                    {t("firma.firmaVKonkurze")}
                  </p>
                </div>
              )}
              {hasLikvidacia && !hasKonkurz && (
                <div className="rounded-lg p-3 mb-2" style={{ background: "var(--warning-bg, #fffbeb)", border: "1px solid var(--warning-border, #fde68a)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--warning, #d97706)" }}>
                    {t("firma.firmaVLikvidacii")}
                  </p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs" style={{ color: "var(--text-muted)" }}>
                {company.employeeCount != null && (
                  <span>{t("firma.zamestnanci", { value: company.employeeCount })}</span>
                )}
                {company.sizeCategory && (
                  <><span>·</span><span>{t("firma.velkostFirmy", { value: company.sizeCategory })}</span></>
                )}
                {company.ownershipType && (
                  <><span>·</span><span>{t("firma.druhVlastnictva", { value: company.ownershipType })}</span></>
                )}
                {company.shareCapital != null && Number(company.shareCapital) > 0 && (
                  <><span>·</span><span>{t("firma.zakladneImanie")}: {fmtEUR(Number(company.shareCapital))}</span></>
                )}
                {latest?.year && (
                  <><span>·</span><span>{t("firma.zavierkaRok", { year: latest.year })}</span></>
                )}
                {stmts.length > 0 && (
                  <><span>·</span><span>{t("firma.provenanceObdobie")}: {stmts[stmts.length - 1]?.year}–{latest?.year}</span></>
                )}
                {company.ruzSyncedAt && (
                  <><span>·</span><span>{t("firma.aktualizovane")}: {new Date(company.ruzSyncedAt).toLocaleDateString(lang === "sk" ? "sk-SK" : "en-GB")}</span></>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── KPI CARDS — reordered: Tržby, Zisk, Vlastné imanie, Aktíva ── */}
        {stmts.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6">
            <MetricCard label={t("firma.kpiTrzby")} value={fmtEUR(latest?.mainActivityRevenue)} sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""} color="#3b82f6" trend={trends.revenue} />
            <MetricCard
              label={t("firma.kpiZiskStrata")}
              value={fmtEUR(latest?.netProfitLoss)}
              sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""}
              color={num(latest?.netProfitLoss) != null && num(latest?.netProfitLoss)! < 0 ? "#ef4444" : "#10b981"}
              trend={trends.profit}
            />
            <MetricCard label={t("firma.kpiVlastneImanie")} value={fmtEUR(latest?.equity)} sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""} color="#f59e0b" trend={trends.equity} />
            <MetricCard label={t("firma.kpiCelkoveAktiva")} value={fmtEUR(latest?.totalAssets)} sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""} color="#8b5cf6" trend={trends.assets} />
          </div>
        ) : (
          <div className="rounded-lg p-4 mb-6 sm:mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
              {t("firma.financneUdajeNedostupne")}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("firma.financneUdajeNedostupneDesc")}
            </p>
          </div>
        )}

        {/* ── INLINE CTA — above the fold, right after KPI cards ── */}
        {stmts.length > 0 && (
          <InlineReportCTA ico={company.ico} name={name} />
        )}

        {/* ── FINANCIAL SUMMARY (H2) — 1-2 sentence narrative, replaces CompanyInsights ── */}
        {financialSummary && (
          <div className="mb-6 sm:mb-8">
            <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
              {t("firma.financneZhrnutie")}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {financialSummary}
            </p>
          </div>
        )}

        {/* ── RISK SIGNALS (H2) — moved up from #11 to #6 ── */}
        {riskCount > 0 && <RiskSignals signals={signals} />}

        {/* Vestník events + Company events as H3 under Risk Signals */}
        {((company.vestnikEvents && company.vestnikEvents.length > 0) || (company.companyEvents && company.companyEvents.length > 0)) && (
          <div className="mb-6 sm:mb-8 no-print">
            {company.vestnikEvents && company.vestnikEvents.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("firma.vestnikUdalosti")}
                </h3>
                <VestnikEvents events={company.vestnikEvents as any} noHeading />
              </div>
            )}
            {company.companyEvents && company.companyEvents.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("firma.orsrUdalosti")}
                </h3>
                <CompanyEvents events={company.companyEvents as any} noHeading />
              </div>
            )}
          </div>
        )}

        {/* ── PEOPLE (H2) — with Signing Authority as H3 ── */}
        {persons.length > 0 && (
          <div className="mb-6 sm:mb-8 no-print">
            <h2 className="text-lg sm:text-xl font-bold mb-3" style={{ color: "var(--text)" }}>
              {t("firma.osoby")}
            </h2>
            <CompanyPersons persons={persons} />
            {company.signingAuthority && (
              <div className="mt-4">
                <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
                  {t("firma.konanieMenom")}
                </h3>
                <SigningAuthoritySection authority={company.signingAuthority} noHeading />
              </div>
            )}
          </div>
        )}

        {/* ── BUSINESS ACTIVITY (H2) ── */}
        {company.businessActivity && (
          <BusinessActivitySection activity={company.businessActivity} />
        )}

        {/* ── SÚVAHA (H2) — chart + table ── */}
        {balanceData && balanceData.totalAssets != null && (
          <div className="mb-6 sm:mb-8 print-section">
            <h2 className="text-lg sm:text-xl font-bold mb-3" style={{ color: "var(--text)" }}>
              {t("firma.suvaha")}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(balanceData.currentAssets != null || balanceData.nonCurrentAssets != null) ? (
                <ChartCard title={t("firma.chartStrukturaSuvaly")}>
                  <BalanceSankeyChart data={balanceData} />
                </ChartCard>
              ) : (
                <ChartCard title={t("firma.chartStrukturaSuvaly")}>
                  <div className="flex items-center justify-center h-[250px] text-sm" style={{ color: "var(--text-muted)" }}>
                    {t("firma.detailnyRozpadNedostupny")}
                  </div>
                </ChartCard>
              )}
              <ChartCard title={t("firma.chartSuvala")}>
                <BalanceSheetTable stmts={stmts} />
              </ChartCard>
            </div>
          </div>
        )}

        {/* ── VÝKAZ ZISKOV A STRÁT (H2) — chart + table ── */}
        {chartData.length > 0 && (
          <div className="mb-6 sm:mb-8 print-section print-break-before">
            <h2 className="text-lg sm:text-xl font-bold mb-3" style={{ color: "var(--text)" }}>
              {t("firma.vykazZiskovStrat")}
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ChartCard title={t("firma.chartTrzbyZisk")}>
                <RevenueProfitChart data={chartData} />
              </ChartCard>
              <ChartCard title={t("firma.detailnyVykaz")}>
                <ProfitLossTable stmts={stmts} />
              </ChartCard>
            </div>
          </div>
        )}

        {/* ── PIOTROSKI F-SCORE (H2) — samostatná sekcia ── */}
        {stmts.length >= 2 && (
          <div className="mb-6 sm:mb-8 print-section">
            <PiotroskiCard result={computePiotroski(stmts)} />
          </div>
        )}

        {/* ── CASH FLOW (H2, collapsible) ── */}
        {stmts.length > 0 && (
          <details className="firma-details mb-6 sm:mb-8 no-print">
            <summary className="cursor-pointer mb-3" style={{ color: "var(--text)" }}>
              <span className="chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
              <h2 className="text-lg sm:text-xl font-bold inline" style={{ color: "var(--text)" }}>
                {t("firma.cashFlow")}
              </h2>
              <span className="text-xs font-normal ml-2" style={{ color: "var(--text-muted)" }}>· {t("firma.cashFlowSummary")}</span>
            </summary>
            <div className="mt-3">
              <CashFlowTable stmts={stmts} />
            </div>
          </details>
        )}

        {/* ── DETAILNÉ FINANČNÉ UKAZOVATELE (H2, collapsible) ── */}
        {stmts.length > 0 && (
          <details className="firma-details mb-6 sm:mb-8 no-print">
            <summary className="cursor-pointer mb-3" style={{ color: "var(--text)" }}>
              <span className="chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
              <h2 className="text-lg sm:text-xl font-bold inline" style={{ color: "var(--text)" }}>
                {t("firma.detailneUkazovatele")}
              </h2>
              <span className="text-xs font-normal ml-2" style={{ color: "var(--text-muted)" }}>· {t("firma.detailneUkazovateleSummary")}</span>
            </summary>
            <div className="mt-3 space-y-6">
              <ExtendedRatios stmts={stmts} />
              <EmployeeTrend stmts={stmts} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Left: Rentabilita — chart + table */}
                <div className="flex flex-col gap-3">
                  <ChartCard title={t("firma.rentabilita")}>
                    <RentabilityChart data={computeFinancialIndicators(stmts)} />
                  </ChartCard>
                  <ChartCard title={t("firma.rentabilitaUkazovatele")}>
                    <RentabilityRatios stmts={stmts} />
                  </ChartCard>
                </div>
                {/* Right: Finančná stabilita — chart + table */}
                <div className="flex flex-col gap-3">
                  <ChartCard title={t("firma.financnaStabilita")}>
                    <StabilityChart data={computeFinancialIndicators(stmts)} />
                  </ChartCard>
                  <ChartCard title={t("firma.stabilitaUkazovatele")}>
                    <StabilityRatios stmts={stmts} />
                  </ChartCard>
                </div>
              </div>
              <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
                {t("firma.metodologia")} {/* */}
                <Link href="/slovnik" className="underline hover:no-underline">{t("firma.metodologiaLink")}</Link>
              </p>
            </div>
          </details>
        )}

        {/* ── REPORT CTA (H2) — primary CTA after financial sections ── */}
        <div className="no-print">
          <ReportCTA ico={company.ico} name={name} />
        </div>

        {/* ── FAQ (H2) — SEO long-tail content ── */}
        <CompanyFAQ
          name={name}
          ico={company.ico}
          city={company.city}
          legalForm={company.legalForm}
          foundedYear={company.establishedAt ? new Date(company.establishedAt).getFullYear() : null}
          latestRevenue={latest ? fmtEUR(latest.mainActivityRevenue) : null}
          latestProfit={latest ? fmtEUR(latest.netProfitLoss) : null}
          latestProfitRaw={latest ? Number(latest.netProfitLoss) : null}
          latestYear={latest?.year}
        />

        {/* ── ZDROJE ÚDAJOV (H2, collapsible) ── */}
        {dataSources.length > 0 && (
          <details className="firma-details mb-6 sm:mb-8 no-print">
            <summary className="cursor-pointer mb-3" style={{ color: "var(--text)" }}>
              <span className="chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg></span>
              <h2 className="text-lg sm:text-xl font-bold inline" style={{ color: "var(--text)" }}>
                {t("firma.zdrojeUdajov")}
              </h2>
              <span className="text-xs font-normal ml-2" style={{ color: "var(--text-muted)" }}>· {t("firma.zdrojeUdajovSummary")}</span>
            </summary>
            <div className="mt-3">
              <DataSourcesSection sources={dataSources} noHeading />
            </div>
          </details>
        )}

        {/* ── SÚVISIACE FIRMY (H2) ── */}
        <div className="no-print mt-8 sm:mt-12">
          <h2 className="text-lg sm:text-xl font-bold mb-4" style={{ color: "var(--text)" }}>
            {t("firma.suvisiaceFirmy")}
          </h2>
          {/* Cross-firm person linking — firmy spojené cez spoločné osoby */}
          {crossFirmLinks.length > 0 && <CrossFirmPersons ico={company.ico} links={crossFirmLinks} lang={lang} />}

          {/* Internal linking: related firms by industry and region */}
          <RelatedFirms
            ico={company.ico}
            city={company.city}
            naceCode={company.naceCode}
            kraj={company.kraj}
            excludeIcos={crossFirmIcos}
            noHeading
            lang={lang}
          />
        </div>
      </div>
    </div>
  );
}
