import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

export const revalidate = 3600; // Regenerate every hour
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://verifa.sk";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/cennik`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/pricing`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
  ];

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
    take: 1000, // Limit for sitemap; could paginate later
    orderBy: { ico: "asc" },
  });

  const companyPages: MetadataRoute.Sitemap = companies.map((c) => ({
    url: `${baseUrl}/firma/${c.ico}-${slugify(c.name)}`,
    lastModified: c.auditVerdict?.createdAt || new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...companyPages];
}
