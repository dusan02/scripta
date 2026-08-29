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
  lastmod: Date,
  changefreq: string,
  priority: number,
  alternates?: Record<string, string>
): string {
  let entry = `<url><loc>${xmlEscape(url)}</loc><lastmod>${lastmod.toISOString()}</lastmod>`;
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
  const pages: string[] = [];
  for (const k of getKrajOptions()) {
    pages.push(buildUrlEntry(`${BASE_URL}/screener/kraj/${k.value}`, new Date(), "weekly", 0.7));
  }
  for (const s of getNaceSections()) {
    pages.push(buildUrlEntry(`${BASE_URL}/screener/odvetvie/${s.section}`, new Date(), "weekly", 0.7));
  }
  return pages;
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
  companies: { ico: string; name: string | null; auditVerdict: { createdAt: Date } | null }[]
): string[] {
  return companies
    .filter((c) => VALID_ICO.test(c.ico))
    .flatMap((c) => {
      const slug = c.name ? `${c.ico}-${slugify(c.name)}` : c.ico;
      const path = `/firma/${slug}`;
      const lastMod = c.auditVerdict?.createdAt || new Date();
      return VALID_LANGS.map((lang) => {
        const url = `${BASE_URL}${localizePath(path, lang)}`;
        const alternates = Object.fromEntries(
          VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
        );
        return buildUrlEntry(url, lastMod, "monthly", 0.6, alternates);
      });
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
    const skip = (sitemapId - 1) * COMPANIES_PER_SITEMAP;
    try {
      const companies = await prisma.company.findMany({
        where: { financialStatements: { some: {} } },
        select: {
          ico: true,
          name: true,
          auditVerdict: { select: { createdAt: true } },
          _count: { select: { financialStatements: true } },
        },
        skip,
        take: COMPANIES_PER_SITEMAP,
        orderBy: { ico: "asc" },
      });
      const filtered = companies.filter((c) => c._count.financialStatements >= 2);
      entries = buildCompanyPages(
        filtered.map((c) => ({ ico: c.ico, name: c.name, auditVerdict: c.auditVerdict }))
      );
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
