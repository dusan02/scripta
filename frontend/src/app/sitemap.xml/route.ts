import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const companyCount = await prisma.company.count({
      where: { financialStatements: { some: {} } },
    });
    sitemapCount = 1 + Math.ceil(companyCount / COMPANIES_PER_SITEMAP);
  } catch {
    // DB unavailable — return just the static sitemap
  }

  const now = new Date().toISOString();
  const entries: string[] = [];

  for (let i = 0; i < sitemapCount; i++) {
    entries.push(
      `<sitemap><loc>${BASE_URL}/sitemap/${i}.xml</loc><lastmod>${now}</lastmod></sitemap>`
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
