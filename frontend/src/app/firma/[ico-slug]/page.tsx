import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { RevenueProfitChart, AssetsEquityChart, BalanceSankeyChart } from "@/components/company-charts";
import { prisma } from "@/lib/prisma";
import { slugify, parseCompanySlug } from "@/lib/slug";

export const dynamicParams = true;
export const revalidate = 86400;

type Params = { params: Promise<{ "ico-slug": string }> };

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

// ── RÚZ parser (port of ruz_parser.py) ──
const ACTIV_OFFSET = 1;
const PASIV_OFFSET = 79;
const INCOME_OFFSET = 1;

function toFloat(val: any): number | null {
  if (val === null || val === undefined || val === "" || val === " ") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    let c = val.trim();
    if (!c) return null;
    let neg = false;
    if (c.startsWith("(") && c.endsWith(")")) { neg = true; c = c.slice(1, -1).trim(); }
    c = c.replace(/[\s\xa0]/g, "");
    if (c.includes(",") && c.includes(".")) {
      if (c.lastIndexOf(",") > c.lastIndexOf(".")) c = c.replace(/\./g, "").replace(",", ".");
      else c = c.replace(/,/g, "");
    } else if (c.includes(",")) c = c.replace(",", ".");
    if ((c.match(/\./g) || []).length > 1) {
      const p = c.split("."); c = p.slice(0, -1).join("") + "." + p[p.length - 1];
    }
    const r = parseFloat(c);
    if (isNaN(r)) return null;
    return neg ? -r : r;
  }
  return null;
}

function getRow(tables: any[], idx: number, cislo: number, offset: number, cols: number): any[] | null {
  if (idx >= tables.length) return null;
  const data = tables[idx]?.data;
  if (!data || !Array.isArray(data)) return null;
  const i = cislo - offset;
  if (i < 0 || i >= data.length) return null;
  const row = data[i];
  if (!row) return null;
  if (!Array.isArray(row) && cols > 0) {
    const s = i * cols;
    if (s + cols <= data.length) return data.slice(s, s + cols);
    return null;
  }
  return Array.isArray(row) ? row : null;
}

function activVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 0, r, ACTIV_OFFSET, 4);
  if (!row) return null;
  const tgt = cur ? 2 : 3;
  const ds = row.length > 4 ? row.length - 4 : 0;
  return toFloat(row[ds + tgt]);
}

function pasivVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 1, r, PASIV_OFFSET, 2);
  if (!row) return null;
  const tgt = cur ? 0 : 1;
  const ds = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[ds + tgt]);
}

function incomeVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 2, r, INCOME_OFFSET, 2);
  if (!row) return null;
  const tgt = cur ? 0 : 1;
  const ds = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[ds + tgt]);
}

function identifyTables(tables: any[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    const n = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (n.includes("strana akt") || n.includes("aktív") || (n.includes("akt") && !n.includes("pas"))) r.aktiv = i;
    else if (n.includes("strana pas") || n.includes("pasív") || n.includes("pas")) r.pasiv = i;
    else if (n.includes("ziskov a str") || n.includes("profit and loss")) r.income = i;
  }
  return r;
}

async function ruzGet(endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.ok) return await r.json();
    return null;
  } catch { return null; }
}

async function seedFromRuz(ico: string) {
  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico, "max-zaznamov": 10 });
  if (!eids?.id?.length) return null;
  const entity = await ruzGet("uctovna-jednotka", { id: eids.id[0] });
  if (!entity) return null;

  const zavierkaIds: number[] = entity.idUctovnychZavierok || [];
  const zavierky: any[] = [];
  for (const zid of zavierkaIds) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (z) zavierky.push(z);
  }
  zavierky.sort((a, b) => (b.obdobieDo || "").localeCompare(a.obdobieDo || ""));

  const stmts: any[] = [];
  const seenYears = new Set<number>();
  for (const z of zavierky) {
    if (stmts.length >= 5) break;
    const year = parseInt((z.obdobieDo || "").match(/20\d{2}/)?.[0] || "0");
    if (!year || seenYears.has(year)) continue;
    seenYears.add(year);

    const allTables: any[] = [];
    for (const vid of (z.idUctovnychVykazov || [])) {
      const v = await ruzGet("uctovny-vykaz", { id: vid });
      if (v?.obsah?.tabulky) allTables.push(...v.obsah.tabulky);
    }
    if (!allTables.length) continue;

    const tm = identifyTables(allTables);
    if (tm.aktiv === undefined || tm.pasiv === undefined) continue;

    const ordered = [allTables[tm.aktiv], allTables[tm.pasiv]];
    if (tm.income !== undefined) ordered.push(allTables[tm.income]);
    const hasIncome = ordered.length > 2;

    const zasobyPrev = activVal(ordered, 34, false);
    const pohladavkyPrev = activVal(ordered, 54, false);
    const zavazkyPrev = pasivVal(ordered, 123, false);

    const zasoby = activVal(ordered, 34);
    const pohladavky = activVal(ordered, 54);
    const zavazkyObchod = pasivVal(ordered, 123);
    const zisk = hasIncome ? incomeVal(ordered, 61) : null;
    const odpisy = hasIncome ? incomeVal(ordered, 21) : null;
    const trzby = hasIncome ? incomeVal(ordered, 1) : null;
    const cogs = hasIncome ? incomeVal(ordered, 10) : null;

    let ocf: number | null = null;
    if (zisk !== null && odpisy !== null) {
      ocf = zisk + odpisy;
      if (zasoby !== null && zasobyPrev !== null) ocf -= zasoby - zasobyPrev;
      if (pohladavky !== null && pohladavkyPrev !== null) ocf -= pohladavky - pohladavkyPrev;
      if (zavazkyObchod !== null && zavazkyPrev !== null) ocf += zavazkyObchod - zavazkyPrev;
    }

    let hrubaMarza: number | null = null;
    if (trzby !== null && cogs !== null) hrubaMarza = trzby - cogs;
    if (hrubaMarza === null && hasIncome) hrubaMarza = incomeVal(ordered, 28);

    stmts.push({
      year, totalAssets: activVal(ordered, 1), currentAssets: activVal(ordered, 33),
      equity: pasivVal(ordered, 80), shortTermLiabilities: pasivVal(ordered, 122),
      longTermLiabilities: pasivVal(ordered, 102), mainActivityRevenue: trzby,
      grossProfit: hrubaMarza, netProfitLoss: zisk, cashAndEquivalents: activVal(ordered, 72),
      operatingCashFlow: ocf, staffCosts: hasIncome ? incomeVal(ordered, 15) : null,
      tradeReceivables: pohladavky, tradePayables: zavazkyObchod, inventory: zasoby,
      depreciation: odpisy, interestExpense: hasIncome ? incomeVal(ordered, 49) : null,
      socialInsuranceLiabilities: pasivVal(ordered, 132), taxLiabilities: pasivVal(ordered, 133),
      employeeLiabilities: pasivVal(ordered, 131), statementType: "SK_GAAP",
      monthsInPeriod: 12, isConsolidated: false,
    });
  }

  const naceMap: Record<string, string> = {
    "49410": "Cestná doprava osobná", "49390": "Ostatná pozemná doprava",
    "49420": "Cestná doprava nákladná",
  };
  const lfMap: Record<string, string> = {
    "112": "s.r.o.", "121": "a.s.", "113": "v.o.s.", "114": "k.s.",
    "101": "fyzická osoba", "107": "živnostník",
  };

  await prisma.company.upsert({
    where: { ico },
    create: {
      ico, name: entity.nazovUJ || null,
      legalForm: lfMap[entity.pravnaForma] || entity.pravnaForma || null,
      city: entity.mesto || null, street: entity.ulica || null,
      zipCode: entity.psc || null, country: "Slovensko",
      establishedAt: entity.datumZalozenia ? new Date(entity.datumZalozenia) : null,
      status: "active", naceCode: entity.skNace || null,
      naceText: naceMap[entity.skNace] || null,
    },
    update: {
      name: entity.nazovUJ || null,
      legalForm: lfMap[entity.pravnaForma] || entity.pravnaForma || null,
      city: entity.mesto || null, street: entity.ulica || null,
      zipCode: entity.psc || null, country: "Slovensko",
      establishedAt: entity.datumZalozenia ? new Date(entity.datumZalozenia) : null,
      status: "active", naceCode: entity.skNace || null,
      naceText: naceMap[entity.skNace] || null,
    },
  });

  for (const s of stmts) {
    await prisma.financialStatement.upsert({
      where: { companyIco_year: { companyIco: ico, year: s.year } },
      create: { companyIco: ico, ...s },
      update: {
        totalAssets: s.totalAssets, currentAssets: s.currentAssets, equity: s.equity,
        shortTermLiabilities: s.shortTermLiabilities, longTermLiabilities: s.longTermLiabilities,
        mainActivityRevenue: s.mainActivityRevenue, grossProfit: s.grossProfit,
        netProfitLoss: s.netProfitLoss, cashAndEquivalents: s.cashAndEquivalents,
        operatingCashFlow: s.operatingCashFlow, staffCosts: s.staffCosts,
        tradeReceivables: s.tradeReceivables, tradePayables: s.tradePayables,
        inventory: s.inventory, depreciation: s.depreciation,
        interestExpense: s.interestExpense,
        socialInsuranceLiabilities: s.socialInsuranceLiabilities,
        taxLiabilities: s.taxLiabilities, employeeLiabilities: s.employeeLiabilities,
      },
    });
  }

  return await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: { orderBy: { year: "desc" }, take: 5 },
      auditVerdict: true,
      vestnikEvents: { orderBy: { publishedAt: "desc" }, take: 5 },
    },
  });
}

async function getCompanyData(ico: string) {
  const company = await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: { orderBy: { year: "desc" }, take: 5 },
      auditVerdict: true,
      vestnikEvents: { orderBy: { publishedAt: "desc" }, take: 5 },
    },
  });
  if (company && company.city && company.legalForm) return company;
  return await seedFromRuz(ico);
}

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

function fmtEUR(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} mil. €`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)} tis. €`;
  return `${val.toFixed(0)} €`;
}

function fmtNum(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}`;
  return val.toFixed(0);
}

function fmtYear(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).getFullYear().toString();
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
  const verdict = company.auditVerdict;
  const vestnikCount = company.vestnikEvents.length;
  const hasVestnikIssues = company.vestnikEvents.some(
    e => e.severityLevel === "CRITICAL" || e.severityLevel === "HIGH"
  );

  const chartData = [...stmts].sort((a, b) => a.year - b.year).map(s => ({
    year: s.year.toString(),
    tržby: s.mainActivityRevenue,
    zisk: s.netProfitLoss,
    aktíva: s.totalAssets,
    vlastnéImanie: s.equity,
  }));

  const balanceData = latest ? [
    { name: "Vlastné imanie", value: latest.equity, color: "#10b981" },
    { name: "Dlhodobé záväzky", value: latest.longTermLiabilities, color: "#f59e0b" },
    { name: "Krátkodobé záväzky", value: latest.shortTermLiabilities, color: "#ef4444" },
  ].filter(d => d.value !== null && d.value !== undefined && d.value !== 0) : [];

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
            <span className="text-xl font-black" style={{ color: "var(--accent)" }}>
              Verifa<span style={{ color: "var(--text)" }}>.sk</span>
            </span>
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

        {/* Balance sheet donut + Financial table */}
        {balanceData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <ChartCard title="Štruktúra súvahy">
              <BalanceSankeyChart data={balanceData} />
            </ChartCard>

            <ChartCard title="Detailné finančné údaje (v tis. €)">
              <FinancialTable stmts={stmts} />
            </ChartCard>
          </div>
        )}

        {/* Risk indicators */}
        {(verdict || vestnikCount > 0) && (
          <div className="rounded-2xl p-6 mb-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text)" }}>Rizikové indikátory</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {verdict && (
                <div className="rounded-xl p-4" style={{ background: "var(--bg-muted)" }}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Verifa skóre</p>
                  <div className="text-2xl font-black" style={{ color: verdict.riskCategory === "AAA" || verdict.riskCategory === "A" ? "#10b981" : verdict.riskCategory === "B" ? "#f59e0b" : "#ef4444" }}>
                    {verdict.riskCategory} ({verdict.verifaScore}/100)
                  </div>
                </div>
              )}
              <div className="rounded-xl p-4" style={{ background: "var(--bg-muted)" }}>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Vestník udalosti</p>
                <div className="text-2xl font-black" style={{ color: hasVestnikIssues ? "#ef4444" : "#10b981" }}>
                  {vestnikCount} {vestnikCount === 1 ? "záznam" : vestnikCount < 5 ? "záznamy" : "záznamov"}
                </div>
                {hasVestnikIssues && <p className="text-xs mt-1" style={{ color: "#ef4444" }}>⚠ Kritické nálezy</p>}
              </div>
              <div className="rounded-xl p-4" style={{ background: "var(--bg-muted)" }}>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Registre</p>
                <div className="text-2xl font-black" style={{ color: "var(--accent)" }}>26+</div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>verejných zdrojov</p>
              </div>
            </div>
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

// ── Components ──

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>{label}</p>
      <div className="text-xl font-black" style={{ color }}>{value}</div>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-sm font-bold mb-4" style={{ color: "var(--text)" }}>{title}</h3>
      {children}
    </div>
  );
}

function FinancialTable({ stmts }: { stmts: any[] }) {
  const rows = [
    { label: "Tržby", key: "mainActivityRevenue" },
    { label: "Hrubá marža", key: "grossProfit" },
    { label: "Zisk/Strata", key: "netProfitLoss" },
    { label: "Celkové aktíva", key: "totalAssets" },
    { label: "Obezný majetok", key: "currentAssets" },
    { label: "Vlastné imanie", key: "equity" },
    { label: "Zásoby", key: "inventory" },
    { label: "Pohľadávky", key: "tradeReceivables" },
    { label: "Osobné náklady", key: "staffCosts" },
    { label: "Odpisy", key: "depreciation" },
  ];
  const sorted = [...stmts].sort((a, b) => b.year - a.year);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: "2px solid var(--border)" }}>
            <th className="text-left py-2 px-1 font-bold" style={{ color: "var(--text-muted)" }}>Ukazovateľ</th>
            {sorted.map(s => (
              <th key={s.year} className="text-right py-2 px-1 font-bold" style={{ color: "var(--text-muted)" }}>{s.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
              <td className="py-2 px-1" style={{ color: "var(--text-secondary)" }}>{row.label}</td>
              {sorted.map(s => (
                <td key={s.year} className="text-right py-2 px-1 font-mono" style={{ color: "var(--text)" }}>
                  {fmtNum(s[row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
