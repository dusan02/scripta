import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const BASE_URL = "https://verifa.sk";
const COMPANIES_PER_SITEMAP = 8000;

/**
 * Sitemap index route handler.
 *
 * Next.js's generateSitemaps is supposed to auto-generate /sitemap.xml,
 * but the /[ico] dynamic route catches it first (returns 404).
 * This explicit route handler takes priority and outputs valid XML.
 */
export async function GET() {
  let sitemapCount = 1; // At least sitemap/0.xml (static + glossary)

  try {
    // fsCount >= 2 replaces financialStatements: { some: {} } — the relation
    // filter compiles to an IN (subquery) semi-join; fsCount is a maintained
    // column with its own index (same quality gate as hub pages).
    const companyCount = await prisma.company.count({
      where: { fsCount: { gte: 2 } },
    });
    sitemapCount = 1 + Math.ceil(companyCount / COMPANIES_PER_SITEMAP);
  } catch {
    // DB unavailable — return just the static sitemap
  }

  const entries: string[] = [];

  for (let i = 0; i < sitemapCount; i++) {
    // Omit lastmod at index level — a fabricated "now" on every child sitemap
    // teaches Google to distrust the sitemap freshness signal.
    entries.push(
      `<sitemap><loc>${BASE_URL}/sitemap/${i}.xml</loc></sitemap>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
