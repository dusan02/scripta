import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { glossaryTerms } from "@/lib/glossary";
import { VALID_LANGS, localizePath, HREFLANG_MAP } from "@/lib/i18n";
import { slugify } from "@/lib/slug";
import { getKrajOptions, getNaceSections } from "@/lib/screener";
import { getAllHubPaths } from "@/lib/hub";

export const revalidate = 3600;

const BASE_URL = "https://verifa.sk";
const COMPANIES_PER_SITEMAP = 8000;
const VALID_ICO = /^\d{8,10}$/;

const STATIC_PATHS = [
  "/", "/pricing", "/register", "/documents", "/slovnik",
  "/terms", "/privacy", "/dpa", "/firmy", "/screener",
];

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildUrlEntry(
  url: string,
  lastmod: Date | null,
  changefreq: string,
  priority: number,
  alternates?: Record<string, string>
): string {
  let entry = `<url><loc>${xmlEscape(url)}</loc>`;
  // Omit lastmod when unknown — a fake "now" lastmod teaches Google to distrust
  // the sitemap and dilutes crawl prioritization (worse than omitting).
  if (lastmod) entry += `<lastmod>${lastmod.toISOString()}</lastmod>`;
  entry += `<changefreq>${changefreq}</changefreq><priority>${priority}</priority>`;
  if (alternates) {
    for (const [lang, altUrl] of Object.entries(alternates)) {
      entry += `<xhtml:link rel="alternate" hreflang="${lang}" href="${xmlEscape(altUrl)}"/>`;
    }
  }
  entry += `</url>`;
  return entry;
}

function buildStaticPages(): string[] {
  return STATIC_PATHS.flatMap((path) =>
    VALID_LANGS.map((lang) => {
      const url = `${BASE_URL}${localizePath(path, lang)}`;
      const alternates = Object.fromEntries(
        VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
      );
      return buildUrlEntry(
        url,
        new Date(),
        path === "/" ? "weekly" : "monthly",
        path === "/" ? 1.0 : 0.8,
        alternates
      );
    })
  );
}

function buildScreenerLandingPages(): string[] {
  // /screener is the only screener URL in sitemap.
  // /screener/kraj/{kraj} and /screener/odvetvie/{section} are redirect URLs —
  // removed from sitemap to avoid redirect-in-sitemap SEO error.
  // Canonical hub URLs (/firmy/{slug}, /kraj/{kraj}) are in buildHubPages().
  return [
    buildUrlEntry(`${BASE_URL}/screener`, new Date(), "weekly", 0.7),
  ];
}

async function buildHubPages(): Promise<string[]> {
  try {
    const hubPaths = await getAllHubPaths();
    return hubPaths.flatMap((hub) => {
      const path = hub.path;
      return VALID_LANGS.map((lang) => {
        const url = `${BASE_URL}${localizePath(path, lang)}`;
        const alternates = Object.fromEntries(
          VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
        );
        return buildUrlEntry(url, new Date(), "weekly", hub.priority, alternates);
      });
    });
  } catch {
    return [];
  }
}

function buildGlossaryPages(): string[] {
  return glossaryTerms.flatMap((term) => {
    const path = `/slovnik/${term.slug}`;
    return VALID_LANGS.map((lang) => {
      const url = `${BASE_URL}${localizePath(path, lang)}`;
      const alternates = Object.fromEntries(
        VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
      );
      return buildUrlEntry(url, new Date(), "monthly", 0.6, alternates);
    });
  });
}

function buildCompanyPages(
  companies: { ico: string; name: string | null; auditVerdict: { createdAt: Date } | null; ruzSyncedAt: Date | null; updatedAt: Date }[]
): string[] {
  // SK canonical URL ONLY per company — localized variants (/en/firma/..., /de/...)
  // are NOT listed as separate <url> entries. They stay live and are discovered
  // via the hreflang annotations below. Declaring all 6 variants multiplied the
  // sitemap to ~1.78M URLs (277K × 6) of near-duplicate thin translations, which
  // diluted Google's crawl budget and suppressed indexation of the canonical set
  // (4,402 indexed / 1.78M declared = 0.25%).
  return companies
    .filter((c) => VALID_ICO.test(c.ico))
    .map((c) => {
      const slug = c.name ? `${c.ico}-${slugify(c.name)}` : c.ico;
      const path = `/firma/${slug}`;
      // Real content freshness — never fabricate "now" (see buildUrlEntry note)
      const lastMod = c.ruzSyncedAt ?? c.updatedAt ?? c.auditVerdict?.createdAt ?? null;
      const alternates = Object.fromEntries(
        VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
      );
      return buildUrlEntry(`${BASE_URL}${path}`, lastMod, "monthly", 0.6, alternates);
    });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sitemapId = parseInt(id, 10);

  if (isNaN(sitemapId) || sitemapId < 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  let entries: string[] = [];

  if (sitemapId === 0) {
    // Sitemap 0: static + screener + hub + glossary
    const hubPages = await buildHubPages();
    entries = [
      ...buildStaticPages(),
      ...buildScreenerLandingPages(),
      ...hubPages,
      ...buildGlossaryPages(),
    ];
  } else {
    // Sitemap 1..N: company pages
    // fsCount >= 2 replaces financialStatements: { some: {} } + _count + JS filter —
    // the relation filter compiles to an IN (subquery) semi-join over FinancialStatement
    // (~1M rows); fsCount is a maintained column with its own index (quality gate).
    const skip = (sitemapId - 1) * COMPANIES_PER_SITEMAP;
    try {
      const companies = await prisma.company.findMany({
        where: { fsCount: { gte: 2 } },
        select: {
          ico: true,
          name: true,
          auditVerdict: { select: { createdAt: true } },
          ruzSyncedAt: true,
          updatedAt: true,
        },
        skip,
        take: COMPANIES_PER_SITEMAP,
        orderBy: { ico: "asc" },
      });
      // Out-of-range sitemap id → 404 (previously returned an empty urlset with 200)
      if (companies.length === 0) {
        return new NextResponse("Not found", { status: 404 });
      }
      entries = buildCompanyPages(companies);
    } catch {
      // DB unavailable — return empty sitemap
      entries = [];
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
