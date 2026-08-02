import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { glossaryTerms } from "@/lib/glossary";

export const revalidate = 3600; // Regenerate every hour
export const dynamic = "force-dynamic";

// Valid IČO: 8-10 digits only
const VALID_ICO = /^\d{8,10}$/;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://verifa.sk";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/register`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/documents`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/slovnik`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${baseUrl}/dpa`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];

  // Glossary term pages
  const glossaryPages: MetadataRoute.Sitemap = glossaryTerms.map((term) => ({
    url: `${baseUrl}/slovnik/${term.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Company pages — fetch companies that have audit verdicts or financial statements
  // Filter to only valid IČO (8-10 digits) to exclude garbage entries like "N/A", "neuvedene"
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
    .map((c) => ({
      url: `${baseUrl}/firma/${c.ico}`,
      lastModified: c.auditVerdict?.createdAt || new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));

  return [...staticPages, ...glossaryPages, ...companyPages];
}
