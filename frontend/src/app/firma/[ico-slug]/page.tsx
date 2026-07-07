import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { slugify, parseCompanySlug } from "@/lib/slug";

export const dynamicParams = true;

type Params = { params: Promise<{ "ico-slug": string }> };

async function getCompanyData(ico: string) {
  const company = await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: {
        orderBy: { year: "desc" },
        take: 1,
      },
      auditVerdict: true,
      vestnikEvents: {
        orderBy: { publishedAt: "desc" },
        take: 5,
      },
    },
  });
  return company;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) return {};

  const company = await getCompanyData(parsed.ico);
  if (!company) return {};

  const name = company.name || `IČO ${company.ico}`;
  const title = `${name} (${company.ico}) – Forenzný Due Diligence & Finančná Analýza | Verifa.sk`;
  const description = `Automatizovaný forenzný report pre ${name} (IČO: ${company.ico}). Preverte si finančné zdravie, Altman Z-skóre a rizikové faktory pred podpisom zmluvy.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: "sk_SK",
      siteName: "Verifa.sk",
      images: [
        {
          url: "/logo-verifa.png",
          width: 1200,
          height: 630,
          alt: `${name} — Verifa.sk Due Diligence Report`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

function getAltmanZone(score: number | null | undefined): { label: string; color: string; bg: string } {
  if (score === null || score === undefined) return { label: "Nedostupné", color: "#64748b", bg: "#f1f5f9" };
  if (score > 2.6) return { label: "Bezpečná zóna", color: "#059669", bg: "#ecfdf5" };
  if (score >= 1.1) return { label: "Šedá zóna", color: "#d97706", bg: "#fffbeb" };
  return { label: "Riziková zóna", color: "#dc2626", bg: "#fef2f2" };
}

function getScoreCategory(cat: string | null | undefined): { label: string; color: string; bg: string } {
  if (!cat) return { label: " nehodnotené", color: "#64748b", bg: "#f1f5f9" };
  const map: Record<string, { label: string; color: string; bg: string }> = {
    AAA: { label: "AAA — Výborná", color: "#059669", bg: "#ecfdf5" },
    A: { label: "A — Dobrá", color: "#2563eb", bg: "#eff6ff" },
    B: { label: "B — Priemerná", color: "#d97706", bg: "#fffbeb" },
    C: { label: "C — Riziková", color: "#dc2626", bg: "#fef2f2" },
  };
  return map[cat] || { label: cat, color: "#64748b", bg: "#f1f5f9" };
}

export default async function CompanyTeaserPage({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  const parsed = parseCompanySlug(icoSlug);
  if (!parsed) notFound();

  const company = await getCompanyData(parsed.ico);
  if (!company) notFound();

  // Redirect to canonical URL if slug doesn't match
  const correctSlug = slugify(company.name);
  if (parsed.slug && parsed.slug !== correctSlug) {
    redirect(`/firma/${company.ico}-${correctSlug}`);
  }

  const name = company.name || `IČO ${company.ico}`;
  const latestStmt = company.financialStatements[0];
  const verdict = company.auditVerdict;
  const scoreCat = getScoreCategory(verdict?.riskCategory);
  const altmanZone = getAltmanZone(null); // Would need altman calculation; show zone from verdict if available
  const vestnikCount = company.vestnikEvents.length;
  const hasVestnikIssues = company.vestnikEvents.some(e => e.severityLevel === "CRITICAL" || e.severityLevel === "HIGH");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `https://verifa.sk/firma/${company.ico}#organization`,
        name: name,
        identifier: company.ico,
        url: `https://verifa.sk/firma/${company.ico}-${correctSlug}`,
      },
      {
        "@type": "Dataset",
        name: `Due Diligence Report — ${name}`,
        description: `Automatizovaný forenzný report pre ${name} (IČO: ${company.ico}).`,
        creator: {
          "@type": "Organization",
          name: "Verifa.sk",
          url: "https://verifa.sk",
        },
        about: {
          "@type": "Organization",
          name: name,
          identifier: company.ico,
        },
        temporalCoverage: latestStmt ? `${latestStmt.year}` : undefined,
      },
    ],
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div className="max-w-[900px] mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-black" style={{ color: "var(--accent)" }}>Verifa.sk</span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
          >
            Prihlásiť sa
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-[900px] mx-auto px-6 py-8">
        {/* Company header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm mb-2" style={{ color: "var(--text-muted)" }}>
            <Link href="/" className="hover:underline">Verifa.sk</Link>
            <span>/</span>
            <span>Firma</span>
          </div>
          <h1 className="text-3xl font-black mb-2" style={{ color: "var(--text)" }}>{name}</h1>
          <div className="flex flex-wrap gap-4 text-sm" style={{ color: "var(--text-secondary)" }}>
            <span><strong>IČO:</strong> {company.ico}</span>
            {company.naceCode && <span><strong>NACE:</strong> {company.naceCode}{company.naceText ? ` — ${company.naceText}` : ""}</span>}
            {latestStmt && <span><strong>Rok:</strong> {latestStmt.year}</span>}
          </div>
        </div>

        {/* Teaser cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Score card */}
          <div className="rounded-xl p-5 border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>Verifa Skóre</p>
            {verdict ? (
              <>
                <div className="text-3xl font-black mb-1" style={{ color: scoreCat.color }}>
                  {verdict.riskCategory}
                </div>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{scoreCat.label}</p>
                <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-muted)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(Math.max(verdict.verifaScore, 0), 100)}%`,
                      background: scoreCat.color,
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Firma zatiaľ nebola hodnotená. Stiahnite report pre kompletné zhodnotenie.</p>
            )}
          </div>

          {/* Financial health card */}
          <div className="rounded-xl p-5 border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>Finančné zdravie</p>
            {latestStmt ? (
              <>
                <div className="text-3xl font-black mb-1" style={{ color: "var(--text)" }}>
                  {latestStmt.year}
                </div>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {latestStmt.netProfitLoss !== null && latestStmt.netProfitLoss >= 0 ? "✓ Zisk" : "✗ Strata"}
                </p>
                {latestStmt.totalAssets !== null && (
                  <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                    Aktíva: {latestStmt.totalAssets >= 1000000
                      ? `${(latestStmt.totalAssets / 1000000).toFixed(2)} mil. €`
                      : `${latestStmt.totalAssets.toLocaleString("sk-SK")} €`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Finančné údaje nie sú dostupné.</p>
            )}
          </div>

          {/* Registers card */}
          <div className="rounded-xl p-5 border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>Verejné registre</p>
            <div className="text-3xl font-black mb-1" style={{ color: "var(--accent)" }}>30+</div>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Preverených zdrojov</p>
            {vestnikCount > 0 && (
              <p className="text-xs mt-2" style={{ color: hasVestnikIssues ? "var(--danger-text)" : "var(--text-muted)" }}>
                {hasVestnikIssues ? "⚠ " : ""}{vestnikCount} vestníkových záznamov
              </p>
            )}
          </div>
        </div>

        {/* What's in the report */}
        <div className="rounded-xl p-6 border mb-8" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="text-lg font-bold mb-4" style={{ color: "var(--text)" }}>Čo obsahuje kompletný report?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              "Kontrola 25 verejných a privátnych registrov",
              "Analýza súvahy, výkazu ziskov a strát a cashflow",
              "Rizikové upozornenia",
              "Insolvenčné registre",
              "DPH a právne registre",
              "Záverečné skóre dôveryhodnosti",
              "Profesionálny PDF report",
              "Export reportu",
            ].map((feat, i) => (
              <div key={i} className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--accent)" }}>✓</span>
                {feat}
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div
          className="rounded-xl p-6 text-center mb-8"
          style={{ background: "var(--accent-light)", border: "1px solid var(--accent-border)" }}
        >
          <h2 className="text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
            Potrebujete kompletný forenzný report pre {name}?
          </h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
            Získajte AI analýzu finančného zdravia, rizikové upozornenia a profesionálny PDF report.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href={`/dashboard?ico=${company.ico}`}
              className="inline-block px-6 py-3 rounded-lg font-bold text-sm transition-colors"
              style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
            >
              Stiahnuť report — 10 €
            </Link>
            <Link
              href="/cennik"
              className="inline-block px-6 py-3 rounded-lg font-bold text-sm border transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              Zobraziť cenník
            </Link>
          </div>
        </div>

        {/* SEO content */}
        <div className="prose prose-sm max-w-none mb-8" style={{ color: "var(--text-secondary)" }}>
          <h2 className="text-base font-bold mb-3" style={{ color: "var(--text)" }}>
            Due Diligence {name} — {company.ico}
          </h2>
          <p className="text-sm leading-relaxed mb-3">
            {name} (IČO: {company.ico}) je slovenská spoločnosť
            {company.naceText ? ` pôsobiaca v oblasti ${company.naceText.toLowerCase()}` : ""}
            {latestStmt ? `, s dostupnými finančnými výkazmi za rok ${latestStmt.year}` : ""}.
            Verifa.sk ponúka automatizovaný forenzný due diligence report, ktorý zhromažďuje dáta z 25 verejných a privátnych registrov Slovenskej republiky.
          </p>
          <p className="text-sm leading-relaxed mb-3">
            Náš report obsahuje analýzu súvahy, výkazu ziskov a strát a cash flow, kontrolu insolvenčných registrov,
            DPH registrov, obchodného vestníka a ďalších zdrojov. Výsledkom je profesionálny PDF report so záverečným skóre dôveryhodnosti.
          </p>
          <p className="text-sm leading-relaxed">
            Objednajte si kompletný report pre {name} a získajte všetky relevantné informácie na jednom mieste —
            rýchlo, prehľadne a v profesionálnom formáte pripravenom na zdieľanie.
          </p>
        </div>
      </div>
    </div>
  );
}
