import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { glossaryTerms } from "@/lib/glossary";
import { VALID_LANGS, localizePath, HREFLANG_MAP } from "@/lib/i18n";
import { slugify } from "@/lib/slug";
import { getKrajOptions, getNaceSections } from "@/lib/screener";
import { getAllHubPaths } from "@/lib/hub";

export const revalidate = 3600;

const BASE_URL = "https://verifa.sk";
const COMPANIES_PER_SITEMAP = 8000;
// 8-10 digits, not all zeros (00000000 is an invalid placeholder IČO that
// leaked into the sitemap as /firma/00000000-...)
const VALID_ICO = /^(?!0{8,10}$)\d{8,10}$/;

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
      // Omit lastmod for static pages — a fabricated "now" teaches Google to
      // distrust the sitemap. Google uses its own crawl data for freshness.
      return buildUrlEntry(
        url,
        null,
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
    buildUrlEntry(`${BASE_URL}/screener`, null, "weekly", 0.7),
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
        return buildUrlEntry(url, null, "weekly", hub.priority, alternates);
      });
    });
  } catch {
    return [];
  }
}

function buildGlossaryPages(): string[] {
  return glossaryTerms.flatMap((term) => {
    const path = `/slovnik/${term.slug}`;
    const isOrsr = term.slug === "orsr";
    return VALID_LANGS.map((lang) => {
      const url = `${BASE_URL}${localizePath(path, lang)}`;
      const alternates = Object.fromEntries(
        VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
      );
      return buildUrlEntry(
        url,
        null,
        isOrsr ? "weekly" : "monthly",
        isOrsr ? 0.9 : 0.6,
        alternates
      );
    });
  });
}

type SitemapCompanyRow = {
  ico: string;
  name: string | null;
  ruzSyncedAt: Date | string | null;
  updatedAt: Date | string;
};

function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function buildCompanyPages(companies: SitemapCompanyRow[]): string[] {
  // SK canonical URL ONLY per company — localized variants (/en/firma/..., /de/...)
  // are NOT listed as separate <url> entries. They stay live and are discovered
  // via the hreflang annotations below.
  return companies
    .filter((c) => VALID_ICO.test(c.ico))
    .map((c) => {
      const slug = c.name ? `${c.ico}-${slugify(c.name)}` : c.ico;
      const path = `/firma/${slug}`;
      // Real content freshness — never fabricate "now" (updatedAt is non-nullable on Company)
      const lastMod = toDateOrNull(c.ruzSyncedAt) ?? toDateOrNull(c.updatedAt);
      const alternates = Object.fromEntries(
        VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
      );
      return buildUrlEntry(`${BASE_URL}${path}`, lastMod, "monthly", 0.6, alternates);
    });
}

async function queryCompanySitemapChunk(sitemapId: number): Promise<SitemapCompanyRow[]> {
  const skip = (sitemapId - 1) * COMPANIES_PER_SITEMAP;
  // Removed dead auditVerdict LEFT JOIN (updatedAt is non-nullable on Company).
  // Designed for index-only scan on Company_fscount2_ico_sitemap_idx (ico ASC INCLUDE name, ruzSyncedAt, updatedAt WHERE fsCount >= 2).
  return prisma.company.findMany({
    where: { fsCount: { gte: 2 } },
    select: {
      ico: true,
      name: true,
      ruzSyncedAt: true,
      updatedAt: true,
    },
    skip,
    take: COMPANIES_PER_SITEMAP,
    orderBy: { ico: "asc" },
  });
}

const getCachedCompanySitemapChunk = unstable_cache(
  async (sitemapId: number) => queryCompanySitemapChunk(sitemapId),
  ["sitemap-company-chunk"],
  { revalidate: 3600 }
);

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
    // Sitemap 1..N: company pages (cached 1h; returns 503 on DB error instead of 200 empty urlset)
    try {
      let companies: SitemapCompanyRow[];
      try {
        companies = await getCachedCompanySitemapChunk(sitemapId);
      } catch {
        companies = await queryCompanySitemapChunk(sitemapId);
      }
      if (companies.length === 0) {
        return new NextResponse("Not found", { status: 404 });
      }
      entries = buildCompanyPages(companies);
    } catch {
      return new NextResponse("Service Unavailable", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      });
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
