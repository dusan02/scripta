import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { glossaryTerms } from "@/lib/glossary";
import { VALID_LANGS, localizePath, HREFLANG_MAP } from "@/lib/i18n";

export const revalidate = 3600; // Regenerate every hour
export const dynamic = "force-dynamic";

// Valid IČO: 8-10 digits only
const VALID_ICO = /^\d{8,10}$/;

const BASE_URL = "https://verifa.sk";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages — with hreflang alternates for all 6 languages
  // SK has no prefix, other langs use /cs/, /en/, etc.
  const staticPaths = [
    "/", "/pricing", "/register", "/documents", "/slovnik",
    "/terms", "/privacy", "/dpa",
  ];

  const staticPages: MetadataRoute.Sitemap = staticPaths.flatMap((path) => {
    return VALID_LANGS.map((lang) => ({
      url: `${BASE_URL}${localizePath(path, lang)}`,
      lastModified: new Date(),
      changeFrequency: path === "/" ? "weekly" : "monthly" as const,
      priority: path === "/" ? 1.0 : 0.8,
      alternates: {
        languages: Object.fromEntries(
          VALID_LANGS.map((l) => [HREFLANG_MAP[l], `${BASE_URL}${localizePath(path, l)}`])
        ),
      },
    }));
  });

  // Glossary term pages
  const glossaryPages: MetadataRoute.Sitemap = glossaryTerms.flatMap((term) => {
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

  // Company pages — fetch companies that have audit verdicts or financial statements
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { auditVerdict: { isNot: null } },
        { financialStatements: { some: {} } },
      ],
    },
    select: {
      ico: true,
      name: true,
      auditVerdict: { select: { createdAt: true } },
    },
    take: 1000,
    orderBy: { ico: "asc" },
  });

  const companyPages: MetadataRoute.Sitemap = companies
    .filter((c) => VALID_ICO.test(c.ico))
    .flatMap((c) => {
      const path = `/firma/${c.ico}`;
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

  return [...staticPages, ...glossaryPages, ...companyPages];
}
