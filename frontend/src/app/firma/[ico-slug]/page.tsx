import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { RevenueProfitChart, BalanceSankeyChart } from "@/components/company-charts";
import { MetricCard, ChartCard, BalanceSheetTable, ProfitLossTable, CashFlowTable, RentabilityRatios, StabilityRatios } from "@/components/firma-ui";
import { RentabilityChart, StabilityChart } from "@/components/financial-indicators-charts";
import { ExtendedRatios, EmployeeTrend } from "@/components/extended-ratios";
import { PiotroskiCard } from "@/components/piotroski-card";
import { computeFinancialIndicators } from "@/lib/financial-indicators";
import { computePiotroski } from "@/lib/piotroski";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { CompanyHeader } from "@/components/company-header";
import { CompanyPersons } from "@/components/company-persons";
import { BusinessActivitySection, SigningAuthoritySection } from "@/components/company-business-activity";
import { RiskSignals } from "@/components/risk-signals";
import { DataSourcesSection } from "@/components/data-sources";
import { ReportCTA, CompanyFAQ } from "@/components/report-cta";
import { CompanyInsights } from "@/components/company-insights";
import { slugify, parseCompanySlug } from "@/lib/slug";
import { fmtEUR, num } from "@/lib/format";
import { calcTrend } from "@/lib/trend";
import { generateCompanyInsights } from "@/lib/company-insights";
import { getCompanyData } from "@/lib/ruz";
import { getServerSession } from "@/lib/auth";
import { getLangFromHeaders, generateFirmaMetadata, getCanonicalUrl } from "@/lib/seo";
import { translate } from "@/lib/i18n";
import { RelatedFirms } from "@/components/related-firms";
import { CrossFirmPersons } from "@/components/cross-firm-persons";
import { PrintButton } from "@/components/PrintButton";
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
  if (!company) {
    // Company not in DB — return noindex + canonical to self (not homepage)
    // notFound() in page.tsx may be swallowed by Sentry, so we must set canonical here
    const h = await headers();
    const lang = getLangFromHeaders(h);
    const slug = parsed.slug || "firma";
    const firmaPath = `/firma/${parsed.ico}-${slug}`;
    return {
      robots: { index: false, follow: false },
      alternates: {
        canonical: getCanonicalUrl(firmaPath, lang),
      },
    };
  }

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

  const h = await headers();
  const lang = getLangFromHeaders(h);
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
          { "@type": "ListItem", position: 2, name: "Firma", item: "https://verifa.sk/firma" },
          { "@type": "ListItem", position: 3, name, item: `https://verifa.sk/firma/${company.ico}` },
        ],
      },
      ...(datasetSchema ? [datasetSchema] : []),
    ],
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header — standalone only for anonymous users (NavBar shown for authenticated) */}
      {!isLoggedIn && (
        <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "sticky", top: 0, zIndex: 10 }}>
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Logo size="sm" />
            </Link>
            <div className="flex items-center gap-1.5 sm:gap-2 no-print">
              <PrintButton />
              <ThemeToggle size="sm" />
              <Link href="/login" className="text-[11px] sm:text-xs font-medium px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg transition-colors" style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                {t("firma.prihlasitSa")}
              </Link>
              <Link
                href={`/dashboard?ico=${company.ico}`}
                className="text-xs sm:text-sm font-bold px-4 sm:px-5 py-2.5 sm:py-2.5 rounded-lg transition-all hover:scale-105"
                style={{ background: "var(--accent)", color: "var(--accent-button-text)", boxShadow: "var(--glow-accent)" }}
              >
                {t("firma.objednatReport")}
              </Link>
            </div>
          </div>
        </header>
      )}

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
        />

        {/* Print-only header with logo — fixed to appear on every page */}
        <div className="print-only-logo">
          <img src="/logo-verifa.png" alt="Verifa.sk" />
        </div>

        {/* Print-only footer — consistent on every page */}
        <div className="print-only-footer">
          <span>© 2026 Verifa.sk</span>
          <span>Business risk report</span>
        </div>

        {/* Source attribution + freshness — prominent status for konkurz/likvidácia */}
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
              <div className="flex flex-wrap gap-1.5">
                {[
                  ...(persons.length > 0 ? ["ORSR"] : []),
                  ...(stmts.length > 0 ? ["RÚZ"] : []),
                  ...(company.vestnikEvents && company.vestnikEvents.length > 0 ? ["Obchodný vestník"] : []),
                ].map(src => (
                  <span key={src} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{src}</span>
                ))}
                {latest?.year && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t("firma.zavierkaRok", { year: latest.year })}</span>
                )}
                {company.sizeCategory && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t("firma.velkostFirmy", { value: company.sizeCategory })}</span>
                )}
                {company.employeeCount != null && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t("firma.zamestnanci", { value: company.employeeCount })}</span>
                )}
                {company.ownershipType && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>{t("firma.druhVlastnictva", { value: company.ownershipType })}</span>
                )}
              </div>
            </div>
          );
        })()}

        {/* Provenance — data source, period, last updated */}
        {stmts.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs mb-3 no-print" style={{ color: "var(--text-muted)" }}>
            <span>{t("firma.provenanceZdroj")}: <strong>{t("firma.provenanceRuz")}</strong></span>
            <span>·</span>
            <span>{t("firma.provenanceObdobie")}: <strong>{stmts[stmts.length - 1]?.year}–{latest?.year}</strong></span>
            {company.ruzSyncedAt && (
              <>
                <span>·</span>
                <span>{t("firma.provenanceAktualizovane")}: <strong>{new Date(company.ruzSyncedAt).toLocaleDateString(lang === "sk" ? "sk-SK" : "en-GB")}</strong></span>
              </>
            )}
          </div>
        )}

        {/* Key metrics cards — first screening */}
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
            <MetricCard label={t("firma.kpiCelkoveAktiva")} value={fmtEUR(latest?.totalAssets)} sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""} color="#8b5cf6" trend={trends.assets} />
            <MetricCard label={t("firma.kpiVlastneImanie")} value={fmtEUR(latest?.equity)} sub={latest ? t("firma.kpiRok", { year: latest.year }) : ""} color="#f59e0b" trend={trends.equity} />
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

        {/* Trends + Persons side-by-side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 sm:mb-6 no-print">
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

        {/* Predmet činnosti — businessActivity (SEO asset) */}
        {company.businessActivity && (
          <BusinessActivitySection activity={company.businessActivity} />
        )}

        {/* Konanie menom spoločnosti — signingAuthority */}
        {company.signingAuthority && (
          <SigningAuthoritySection authority={company.signingAuthority} />
        )}

        {/* Risk signals — konkurz, likvidácia, forenzné signály z FS */}
        {(() => {
          const signals: Array<{
            id: string;
            type: "legal_status" | "vestnik" | "forensic" | "financial";
            severity: "critical" | "high" | "medium" | "low";
            title: string;
            description: string;
            source: string;
            date?: string | null;
          }> = [];

          // Legal status signals
          if (company.legalStatus === "BANKRUPT") {
            signals.push({
              id: "legal-bankrupt",
              type: "legal_status",
              severity: "critical",
              title: t("firma.statusBankrupt"),
              description: "Firma je v konkurznom konaní.",
              source: company.legalStatusSource || "ORSR",
            });
          }
          if (company.legalStatus === "RESTRUCTURING") {
            signals.push({
              id: "legal-restructuring",
              type: "legal_status",
              severity: "critical",
              title: t("firma.statusRestructuring"),
              description: "Firma je v reštrukturalizačnom konaní.",
              source: company.legalStatusSource || "ORSR",
            });
          }
          if (company.legalStatus === "LIQUIDATION") {
            signals.push({
              id: "legal-liquidation",
              type: "legal_status",
              severity: "high",
              title: t("firma.statusLiquidation"),
              description: "Firma je v likvidácii.",
              source: company.legalStatusSource || "ORSR",
            });
          }

          // Vestnik events as risk signals
          if (company.vestnikEvents) {
            for (const ev of company.vestnikEvents.slice(0, 5)) {
              const sev = ev.severityLevel === "CRITICAL" ? "critical" :
                         ev.severityLevel === "HIGH" ? "high" :
                         ev.severityLevel === "MEDIUM" ? "medium" : "low";
              signals.push({
                id: `vestnik-${ev.id}`,
                type: "vestnik",
                severity: sev as any,
                title: ev.eventType,
                description: ev.summary,
                source: "Obchodný vestník",
                date: new Date(ev.publishedAt).toLocaleDateString("sk-SK"),
              });
            }
          }

          // Forensic signals from latest FS
          if (latest) {
            const socIns = num(latest.socialInsuranceLiabilities);
            const taxLiab = num(latest.taxLiabilities);
            const empLiab = num(latest.employeeLiabilities);

            if (socIns != null && socIns > 0) {
              signals.push({
                id: "forensic-soc-ins",
                type: "forensic",
                severity: "high",
                title: "Záväzky voči sociálnej poisťovni",
                description: `Neuhradené záväzky voči sociálnej poisťovni: ${fmtEUR(socIns)} (rok ${latest.year}). Zdroj: účtovná závierka, riadok 336A.`,
                source: "RÚZ",
                date: String(latest.year),
              });
            }
            if (taxLiab != null && taxLiab > 0) {
              signals.push({
                id: "forensic-tax",
                type: "forensic",
                severity: "high",
                title: "Daňové záväzky",
                description: `Daňové záväzky a dotácie: ${fmtEUR(taxLiab)} (rok ${latest.year}). Zdroj: účtovná závierka, riadky 341-347.`,
                source: "RÚZ",
                date: String(latest.year),
              });
            }
            if (empLiab != null && empLiab > 0) {
              signals.push({
                id: "forensic-emp",
                type: "forensic",
                severity: "medium",
                title: "Záväzky voči zamestnancom",
                description: `Záväzky voči zamestnancom: ${fmtEUR(empLiab)} (rok ${latest.year}). Zdroj: účtovná závierka, riadky 331, 333.`,
                source: "RÚZ",
                date: String(latest.year),
              });
            }
          }

          // Negative equity
          if (latest && num(latest.equity) != null && num(latest.equity)! < 0) {
            signals.push({
              id: "financial-neg-equity",
              type: "financial",
              severity: "high",
              title: "Záporné vlastné imanie",
              description: `Vlastné imanie firmy je záporné (${fmtEUR(num(latest.equity))}) k roku ${latest.year}. Záväzky prevyšujú aktíva.`,
              source: "RÚZ",
              date: String(latest.year),
            });
          }

          return signals.length > 0 ? <RiskSignals signals={signals} /> : null;
        })()}

        {/* Vestník events — zdroj: Obchodný vestník SR */}
        {company.vestnikEvents && company.vestnikEvents.length > 0 && (
          <div className="no-print">
            <VestnikEvents events={company.vestnikEvents as any} />
          </div>
        )}

        {/* Company events — zdroj: ORSR, Vestník (verejné registre) */}
        {company.companyEvents && company.companyEvents.length > 0 && (
          <div className="no-print">
            <CompanyEvents events={company.companyEvents as any} />
          </div>
        )}


        {/* Balance Sheet section — chart left, table right */}
        {balanceData && balanceData.totalAssets != null && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8 print-section">
            {/* Only show Sankey if we have meaningful breakdown (not just totalAssets) */}
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
        )}

        {/* Profit and Loss section — chart left, table right */}
        {chartData.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8 print-section print-break-before">
            <ChartCard title={t("firma.chartTrzbyZisk")}>
              <RevenueProfitChart data={chartData} />
            </ChartCard>
            <ChartCard title={t("firma.chartVykazZiskovStrat")}>
              <ProfitLossTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* Cash Flow table — len ak máme aspoň jeden CF údaj */}
        {stmts.length > 0 && (
          <div className="mb-6 sm:mb-8 print-section">
            <CashFlowTable stmts={stmts} />
          </div>
        )}

        {/* Extended ratios — quick ratio, working capital, D/E, interest coverage */}
        {stmts.length > 0 && (
          <div className="mb-6 sm:mb-8 print-section">
            <ExtendedRatios stmts={stmts} />
          </div>
        )}

        {/* Piotroski F-Score — len ak máme ≥2 roky dát */}
        {stmts.length >= 2 && (
          <div className="mb-6 sm:mb-8 print-section">
            <PiotroskiCard result={computePiotroski(stmts)} />
          </div>
        )}

        {/* Employee count trend — len ak máme ≥2 dátové body */}
        {stmts.length > 0 && (
          <div className="mb-6 sm:mb-8 print-section">
            <EmployeeTrend stmts={stmts} />
          </div>
        )}

        {/* Financial ratios — 2 columns: Rentabilita | Finančná stabilita */}
        {stmts.length > 0 && (
          <div className="mb-6 sm:mb-8 print-section print-break-before-avoid">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Rentabilita — chart + table */}
              <div className="flex flex-col gap-3">
                <ChartCard title={t("firma.rentabilita")}>
                  <RentabilityChart data={computeFinancialIndicators(stmts)} />
                </ChartCard>
                <ChartCard title={t("firma.financneUkazovatele")}>
                  <RentabilityRatios stmts={stmts} />
                </ChartCard>
              </div>
              {/* Right: Finančná stabilita — chart + table */}
              <div className="flex flex-col gap-3">
                <ChartCard title={t("firma.financnaStabilita")}>
                  <StabilityChart data={computeFinancialIndicators(stmts)} />
                </ChartCard>
                <ChartCard title={t("firma.financneUkazovatele")}>
                  <StabilityRatios stmts={stmts} />
                </ChartCard>
              </div>
            </div>
            <p className="text-[11px] mt-2 no-print" style={{ color: "var(--text-muted)" }}>
              {t("firma.metodologia")} {/* */}
              <Link href="/slovnik" className="underline hover:no-underline">{t("firma.metodologiaLink")}</Link>
            </p>
          </div>
        )}

        {/* Unified CTA — single strong call-to-action (replaces 3 duplicate CTAs) */}
        <div className="no-print">
          <ReportCTA ico={company.ico} name={name} />
        </div>

        {/* FAQ — dynamic per-company SEO content */}
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

        {/* Data sources — trust/provenance */}
        {(() => {
          const sources: Array<{ name: string; syncedAt: Date | null; dataRange?: string | null }> = [];

          if (company.companyPersons && company.companyPersons.length > 0) {
            sources.push({
              name: "Obchodný register SR (ORSR)",
              syncedAt: company.orsrSyncedAt ?? null,
            });
          }
          if (stmts.length > 0) {
            const years = stmts.map(s => s.year).sort();
            sources.push({
              name: "Register účtovných závierok (RÚZ)",
              syncedAt: company.ruzSyncedAt ?? null,
              dataRange: years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : String(years[0]),
            });
          }
          if (company.vestnikEvents && company.vestnikEvents.length > 0) {
            sources.push({
              name: "Obchodný vestník SR",
              syncedAt: company.vestnikSyncedAt ?? null,
            });
          }

          return sources.length > 0 ? <DataSourcesSection sources={sources} /> : null;
        })()}

        <div className="no-print">
          {/* Cross-firm person linking — firmy spojené cez spoločné osoby */}
          <CrossFirmPersons ico={company.ico} />

          {/* Internal linking: related firms by industry and region */}
          <RelatedFirms ico={company.ico} city={company.city} naceCode={company.naceCode} kraj={company.kraj} />
        </div>
      </div>
    </div>
  );
}
