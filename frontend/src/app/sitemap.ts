import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { glossaryTerms } from "@/lib/glossary";
import { VALID_LANGS, localizePath, HREFLANG_MAP } from "@/lib/i18n";
import { slugify } from "@/lib/slug";

export const revalidate = 3600; // Regenerate every hour
export const dynamic = "force-dynamic";

// Valid IČO: 8-10 digits only
const VALID_ICO = /^\d{8,10}$/;

const BASE_URL = "https://verifa.sk";

// Each company generates 6 URLs (one per language).
// Google limit: 50,000 URLs per sitemap. 8000 companies × 6 langs = 48,000 — safe.
const COMPANIES_PER_SITEMAP = 8000;

const STATIC_PATHS = [
  "/", "/pricing", "/register", "/documents", "/slovnik",
  "/terms", "/privacy", "/dpa", "/firmy", "/screener",
];

function buildStaticPages(): MetadataRoute.Sitemap {
  return STATIC_PATHS.flatMap((path) =>
    VALID_LANGS.map((lang) => ({
      url: `${BASE_URL}${localizePath(path, lang)}`,
      lastModified: new Date(),
      changeFrequency: path === "/" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "/" ? 1.0 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
        ),
      },
    }))
  );
}

function buildGlossaryPages(): MetadataRoute.Sitemap {
  return glossaryTerms.flatMap((term) => {
    const path = `/slovnik/${term.slug}`;
    return VALID_LANGS.map((lang) => ({
      url: `${BASE_URL}${localizePath(path, lang)}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
      alternates: {
        languages: Object.fromEntries(
          VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
        ),
      },
    }));
  });
}

function buildCompanyPages(
  companies: { ico: string; name: string | null; auditVerdict: { createdAt: Date } | null }[]
): MetadataRoute.Sitemap {
  return companies
    .filter((c) => VALID_ICO.test(c.ico))
    .flatMap((c) => {
      const slug = c.name ? `${c.ico}-${slugify(c.name)}` : c.ico;
      const path = `/firma/${slug}`;
      const lastMod = c.auditVerdict?.createdAt || new Date();
      return VALID_LANGS.map((lang) => ({
        url: `${BASE_URL}${localizePath(path, lang)}`,
        lastModified: lastMod,
        changeFrequency: "monthly" as const,
        priority: 0.6,
        alternates: {
          languages: Object.fromEntries(
            VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
          ),
        },
      }));
    });
}

// Generate sitemap IDs: [0] = static + glossary, [1..N] = company batches
export async function generateSitemaps() {
  try {
    const companyCount = await prisma.company.count({
      where: {
        financialStatements: { some: {} },
      },
    });

    const companySitemapCount = Math.ceil(companyCount / COMPANIES_PER_SITEMAP);
    return Array.from({ length: 1 + companySitemapCount }, (_, i) => ({ id: i }));
  } catch {
    return [{ id: 0 }];
  }
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  // Sitemap 0: static + glossary pages (always small, ~100 URLs)
  if (id === 0) {
    return [...buildStaticPages(), ...buildGlossaryPages()];
  }

  // Sitemap 1..N: company pages (8000 companies each)
  const skip = (id - 1) * COMPANIES_PER_SITEMAP;

  const companies = await prisma.company.findMany({
    where: {
      financialStatements: { some: {} },
    },
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

  // Filter to ≥2 financial statements (quality gate)
  const filtered = companies.filter((c) => c._count.financialStatements >= 2);
  return buildCompanyPages(
    filtered.map((c) => ({ ico: c.ico, name: c.name, auditVerdict: c.auditVerdict }))
  );
}
