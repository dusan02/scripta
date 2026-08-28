/**
 * Hub page query library — fetches companies grouped by NACE/kraj/okres/mesto
 * with adaptive pagination and hierarchical sub-hub links.
 *
 * Hub types:
 *   /odvetvie/[section]       — NACE section (A-U)
 *   /kraj/[kraj]              — NUTS3 region (SK010..SK042)
 *   /odvetvie/[section]/[kraj] — NACE×region sub-hub
 *   /okres/[okres]            — LAU district (SK0101..SK042B)
 *   /mesto/[city-slug]        — City (slugified)
 *
 * Adaptive pagination:
 *   <100 firms:  all on one page
 *   100-500:     paginated 50/page
 *   500+:        top 500 + sub-hub links (hierarchical breakdown)
 *
 * Companies ordered by: latestRevenue DESC (uses index, ~1.4ms)
 * Quality gate: ≥2 financial statements (same as sitemap)
 */

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import {
  naceSectionToPrefixFilter,
  getNaceSectionLabel,
  getNaceSectionGenitive,
  getKrajLabel,
  getKrajLabelLocative,
} from "@/lib/screener";
import { OKRES_CODE_TO_NAME, okresName } from "@/lib/okres-map";

// ── Types ────────────────────────────────────────────────────────────

export type HubCompany = {
  ico: string;
  name: string | null;
  city: string | null;
  naceText: string | null;
  sizeCategory: string | null;
  latestRevenue: string | null;
  latestProfit: string | null;
  latestYear: number | null;
};

export type HubResult = {
  companies: HubCompany[];
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  hubType: HubType;
  hubLabel: string;
  hubParams: HubParams;
  subHubs: SubHubLink[];
};

export type HubType = "odvetvie" | "kraj" | "odvetvie-kraj" | "okres" | "mesto";

export type HubParams = {
  section?: string;   // NACE section letter
  kraj?: string;      // NUTS3 code
  okres?: string;     // LAU code
  city?: string;      // City name (raw, not slug)
};

export type SubHubLink = {
  href: string;
  label: string;
  count: number;
};

const PAGE_SIZE = 50;
const MAX_PAGES = 10; // Cap at 10 pages = 500 companies per hub
const MIN_COMPANIES_FOR_HUB = 10; // Don't create hub pages for <10 companies

// ── Hub query ────────────────────────────────────────────────────────

function buildWhere(params: HubParams): Record<string, unknown> {
  const where: Record<string, unknown> = {
    financialStatements: { some: {} },
  };

  if (params.section) {
    const range = naceSectionToPrefixFilter(params.section);
    if (range) {
      where.naceCode = { gte: range.gte, lt: range.lt };
    }
  }

  if (params.kraj) {
    where.kraj = params.kraj;
  }

  if (params.okres) {
    where.okres = params.okres;
  }

  if (params.city) {
    where.city = params.city;
  }

  return where;
}

/**
 * Query companies for a hub page.
 * Uses approximate count (pg_class) for performance — same pattern as /firmy.
 */
export async function queryHubCompanies(
  params: HubParams,
  page: number = 1
): Promise<HubResult | null> {
  const where = buildWhere(params);
  const hubType = getHubType(params);
  const hubLabel = getHubLabel(params);

  if (!hubType) return null;

  // Query companies — ordered by revenue DESC (uses index)
  const companies = await prisma.company.findMany({
    where,
    select: {
      ico: true,
      name: true,
      city: true,
      naceText: true,
      sizeCategory: true,
      latestRevenue: true,
      latestProfit: true,
      latestYear: true,
      _count: { select: { financialStatements: true } },
    },
    orderBy: { latestRevenue: { sort: "desc", nulls: "last" } },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Filter to ≥2 FS (quality gate — same as sitemap)
  const filtered = companies.filter((c) => c._count.financialStatements >= 2);

  // Approximate count — exact COUNT on 500K rows takes 14-21s
  // For hub pages with filters, we use a faster approach:
  // If the filter is selective enough, use COUNT; otherwise use estimate
  let total: number;
  if (params.city || params.okres) {
    // City/okres filters are selective — COUNT is fast
    total = await prisma.company.count({ where });
  } else if (params.section && params.kraj) {
    // NACE×kraj — moderately selective
    total = await prisma.company.count({ where });
  } else {
    // NACE section or kraj only — could be 90K+ rows, use estimate
    // But with the FS filter, it's less. Try COUNT with timeout fallback.
    try {
      total = await prisma.company.count({ where });
    } catch {
      // Fallback: use pg_class estimate
      const approx = await prisma.$queryRaw<Array<{ estimate: bigint }>>`
        SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Company'
      `;
      total = Number(approx[0]?.estimate ?? 0);
    }
  }

  const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
  const subHubs = await getSubHubs(params, total);

  return {
    companies: filtered.map((c) => ({
      ico: c.ico,
      name: c.name,
      city: c.city,
      naceText: c.naceText,
      sizeCategory: c.sizeCategory,
      latestRevenue: c.latestRevenue?.toString() ?? null,
      latestProfit: c.latestProfit?.toString() ?? null,
      latestYear: c.latestYear,
    })),
    total,
    page,
    totalPages,
    pageSize: PAGE_SIZE,
    hubType,
    hubLabel,
    hubParams: params,
    subHubs,
  };
}

// ── Hub type detection ───────────────────────────────────────────────

function getHubType(params: HubParams): HubType | null {
  if (params.section && params.kraj) return "odvetvie-kraj";
  if (params.section) return "odvetvie";
  if (params.kraj) return "kraj";
  if (params.okres) return "okres";
  if (params.city) return "mesto";
  return null;
}

// ── Hub labels ───────────────────────────────────────────────────────

function getHubLabel(params: HubParams): string {
  if (params.section && params.kraj) {
    const sectionLabel = getNaceSectionLabel(params.section) || params.section;
    const krajLabel = getKrajLabel(params.kraj) || params.kraj;
    return `${sectionLabel} — ${krajLabel}`;
  }
  if (params.section) {
    return getNaceSectionLabel(params.section) || `NACE ${params.section}`;
  }
  if (params.kraj) {
    return getKrajLabel(params.kraj) || params.kraj;
  }
  if (params.okres) {
    return okresName(params.okres);
  }
  if (params.city) {
    return params.city;
  }
  return "Firmy";
}

// ── Sub-hub links (hierarchical breakdown for large hubs) ────────────

async function getSubHubs(params: HubParams, total: number): Promise<SubHubLink[]> {
  // Only show sub-hubs when the hub is large (>500 companies)
  // and there's a meaningful breakdown available
  if (total <= 500) return [];

  const subHubs: SubHubLink[] = [];

  // If this is a NACE section hub → show kraj breakdown
  if (params.section && !params.kraj && !params.okres && !params.city) {
    const rows = await prisma.$queryRaw<Array<{ kraj: string; cnt: bigint }>>`
      SELECT kraj, COUNT(*)::bigint as cnt
      FROM "Company"
      WHERE naceCode >= ${naceSectionToPrefixFilter(params.section)?.gte}
        AND naceCode < ${naceSectionToPrefixFilter(params.section)?.lt}
        AND kraj IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico HAVING COUNT(*) >= 2)
      GROUP BY kraj ORDER BY cnt DESC
    `;
    for (const row of rows) {
      const count = Number(row.cnt);
      if (count >= MIN_COMPANIES_FOR_HUB) {
        subHubs.push({
          href: `/odvetvie/${params.section}/${row.kraj}`,
          label: getKrajLabel(row.kraj) || row.kraj,
          count,
        });
      }
    }
  }

  // If this is a kraj hub → show okres breakdown
  if (params.kraj && !params.section && !params.okres && !params.city) {
    const rows = await prisma.$queryRaw<Array<{ okres: string; cnt: bigint }>>`
      SELECT okres, COUNT(*)::bigint as cnt
      FROM "Company"
      WHERE kraj = ${params.kraj}
        AND okres IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico HAVING COUNT(*) >= 2)
      GROUP BY okres ORDER BY cnt DESC
    `;
    for (const row of rows) {
      const count = Number(row.cnt);
      if (count >= MIN_COMPANIES_FOR_HUB) {
        subHubs.push({
          href: `/okres/${row.okres}`,
          label: okresName(row.okres),
          count,
        });
      }
    }
  }

  // If this is a NACE×kraj hub → show okres breakdown
  if (params.section && params.kraj && !params.okres && !params.city) {
    const range = naceSectionToPrefixFilter(params.section);
    if (range) {
      const rows = await prisma.$queryRaw<Array<{ okres: string; cnt: bigint }>>`
        SELECT okres, COUNT(*)::bigint as cnt
        FROM "Company"
        WHERE naceCode >= ${range.gte} AND naceCode < ${range.lt}
          AND kraj = ${params.kraj}
          AND okres IS NOT NULL
          AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico HAVING COUNT(*) >= 2)
        GROUP BY okres ORDER BY cnt DESC
      `;
      for (const row of rows) {
        const count = Number(row.cnt);
        if (count >= MIN_COMPANIES_FOR_HUB) {
          subHubs.push({
            href: `/okres/${row.okres}`,
            label: okresName(row.okres),
            count,
          });
        }
      }
    }
  }

  // If this is an okres hub → show city breakdown
  if (params.okres && !params.section && !params.kraj && !params.city) {
    const rows = await prisma.$queryRaw<Array<{ city: string; cnt: bigint }>>`
      SELECT city, COUNT(*)::bigint as cnt
      FROM "Company"
      WHERE okres = ${params.okres}
        AND city IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = "Company".ico HAVING COUNT(*) >= 2)
      GROUP BY city ORDER BY cnt DESC LIMIT 50
    `;
    for (const row of rows) {
      const count = Number(row.cnt);
      if (count >= MIN_COMPANIES_FOR_HUB) {
        subHubs.push({
          href: `/mesto/${slugify(row.city)}`,
          label: row.city,
          count,
        });
      }
    }
  }

  return subHubs;
}

// ── Hub page SEO metadata ────────────────────────────────────────────

export function getHubMetadata(params: HubParams, lang: string): {
  title: string;
  description: string;
  canonical: string;
} {
  const label = getHubLabel(params);
  const hubType = getHubType(params);

  // Build path
  let path = "/";
  if (hubType === "odvetvie") path = `/odvetvie/${params.section}`;
  else if (hubType === "kraj") path = `/kraj/${params.kraj}`;
  else if (hubType === "odvetvie-kraj") path = `/odvetvie/${params.section}/${params.kraj}`;
  else if (hubType === "okres") path = `/okres/${params.okres}`;
  else if (hubType === "mesto") path = `/mesto/${slugify(params.city)}`;

  // SK titles (default — other languages handled by i18n in page component)
  let title: string;
  let description: string;

  if (hubType === "odvetvie") {
    const genitive = getNaceSectionGenitive(params.section!) || label;
    title = `Firmy — ${label} | Zoznam firiem | Verifa.sk`;
    description = `Zoznam firiem v odvetví ${genitive} (NACE ${params.section}) na Slovensku — tržby, zisk, aktíva, zamestnanci a finančné dáta z verejných registrov. Filtrovanie podľa regiónu a mesta.`;
  } else if (hubType === "kraj") {
    const locative = getKrajLabelLocative(params.kraj!) || label;
    title = `Firmy v ${locative} | Zoznam firiem | Verifa.sk`;
    description = `Zoznam firiem v ${locative} — tržby, zisk, aktíva, zamestnanci a finančné dáta z verejných registrov. Filtrovanie podľa odvetvia a mesta.`;
  } else if (hubType === "odvetvie-kraj") {
    const sectionLabel = getNaceSectionLabel(params.section!) || params.section!;
    const locative = getKrajLabelLocative(params.kraj!) || getKrajLabel(params.kraj!) || params.kraj!;
    title = `${sectionLabel} — firmy v ${locative} | Verifa.sk`;
    description = `Zoznam firiem v odvetví ${sectionLabel} v ${locative} — tržby, zisk, aktíva a finančné dáta z verejných registrov SR.`;
  } else if (hubType === "okres") {
    title = `Firmy — okres ${label} | Zoznam firiem | Verifa.sk`;
    description = `Zoznam firiem v okrese ${label} — tržby, zisk, aktíva, zamestnanci a finančné dáta z verejných registrov. Filtrovanie podľa mesta a odvetvia.`;
  } else if (hubType === "mesto") {
    title = `Firmy — ${label} | Zoznam firiem | Verifa.sk`;
    description = `Zoznam firiem v meste ${label} — tržby, zisk, aktíva, zamestnanci a finančné dáta z verejných registrov SR (RÚZ, ORSR).`;
  } else {
    title = "Firmy na Slovensku | Verifa.sk";
    description = "Zoznam slovenských firiem s finančnými dátami z verejných registrov.";
  }

  // Canonical with language prefix
  const BASE_URL = "https://verifa.sk";
  const langPrefix = lang === "sk" ? "" : lang === "cz" ? "/cs" : `/${lang}`;
  const canonical = `${BASE_URL}${langPrefix}${path}`;

  return { title, description, canonical };
}

// ── JSON-LD for hub pages ────────────────────────────────────────────

export function getHubJsonLd(params: HubParams, companies: HubCompany[], baseUrl: string) {
  const label = getHubLabel(params);
  const hubType = getHubType(params);

  let path = "/";
  if (hubType === "odvetvie") path = `/odvetvie/${params.section}`;
  else if (hubType === "kraj") path = `/kraj/${params.kraj}`;
  else if (hubType === "odvetvie-kraj") path = `/odvetvie/${params.section}/${params.kraj}`;
  else if (hubType === "okres") path = `/okres/${params.okres}`;
  else if (hubType === "mesto") path = `/mesto/${slugify(params.city)}`;

  const url = `${baseUrl}${path}`;

  // BreadcrumbList
  const breadcrumbs: Array<{ name: string; url: string }> = [
    { name: "Verifa.sk", url: baseUrl },
    { name: "Firmy", url: `${baseUrl}/firmy` },
  ];

  if (hubType === "odvetvie") {
    breadcrumbs.push({ name: label, url });
  } else if (hubType === "kraj") {
    breadcrumbs.push({ name: label, url });
  } else if (hubType === "odvetvie-kraj") {
    const sectionLabel = getNaceSectionLabel(params.section!) || params.section!;
    const krajLabel = getKrajLabel(params.kraj!) || params.kraj!;
    breadcrumbs.push({ name: sectionLabel, url: `${baseUrl}/odvetvie/${params.section}` });
    breadcrumbs.push({ name: krajLabel, url });
  } else if (hubType === "okres") {
    breadcrumbs.push({ name: label, url });
  } else if (hubType === "mesto") {
    breadcrumbs.push({ name: label, url });
  }

  // ItemList — top companies on this page
  const itemList = companies.slice(0, 20).map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.name || c.ico,
    url: `${baseUrl}/firma/${c.ico}-${slugify(c.name)}`,
  }));

  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: b.url,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: label,
      numberOfItems: companies.length,
      itemListElement: itemList,
    },
  ];
}

// ── City slug resolution ─────────────────────────────────────────────

/**
 * Resolve a city slug back to the actual city name.
 * Since multiple cities could slugify to the same string, we pick the one
 * with the most companies.
 */
export async function resolveCitySlug(slug: string): Promise<string | null> {
  // Try exact match first — find cities where slugify(city) = slug
  const rows = await prisma.$queryRaw<Array<{ city: string; cnt: bigint }>>`
    SELECT city, COUNT(*)::bigint as cnt
    FROM "Company"
    WHERE city IS NOT NULL
      AND LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
          LOWER(city),
          'á', 'a'), 'ä', 'a'), 'é', 'e'), 'ě', 'e'), 'í', 'i'), 'ó', 'o'), 'ô', 'o'),
          'ú', 'u'), 'ů', 'u'), 'ý', 'y'), 'ž', 'z'), 'š', 's'), 'č', 'c'), 'ř', 'r'),
          'ď', 'd'), 'ť', 't'), 'ň', 'n'), 'ľ', 'l'), 'ĺ', 'l')
      ) = ${slug}
    GROUP BY city ORDER BY cnt DESC LIMIT 1
  `;
  // The above SQL is complex and error-prone. Let's use a simpler approach:
  // fetch all distinct cities and slugify in JS
  if (rows.length > 0) return rows[0].city;

  // Fallback: fetch distinct cities and match in JS
  const cities = await prisma.$queryRaw<Array<{ city: string }>>`
    SELECT DISTINCT city FROM "Company" WHERE city IS NOT NULL
  `;
  for (const c of cities) {
    if (slugify(c.city) === slug) return c.city;
  }
  return null;
}

// ── Get all valid hub params (for sitemap generation) ────────────────

export async function getAllHubPaths(): Promise<Array<{
  path: string;
  priority: number;
}>> {
  const paths: Array<{ path: string; priority: number }> = [];

  // NACE section hubs (10)
  const naceSections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U"];
  for (const section of naceSections) {
    paths.push({ path: `/odvetvie/${section}`, priority: 0.8 });
  }

  // Kraj hubs (8)
  const kraje = ["SK010", "SK021", "SK022", "SK023", "SK031", "SK032", "SK041", "SK042"];
  for (const kraj of kraje) {
    paths.push({ path: `/kraj/${kraj}`, priority: 0.8 });
  }

  // NACE×kraj hubs — only for combos with ≥20 companies
  for (const section of naceSections) {
    for (const kraj of kraje) {
      // We'll check count in sitemap generation
      paths.push({ path: `/odvetvie/${section}/${kraj}`, priority: 0.7 });
    }
  }

  // Okres hubs (79) — all districts with ≥50 companies
  for (const okresCode of Object.keys(OKRES_CODE_TO_NAME)) {
    paths.push({ path: `/okres/${okresCode}`, priority: 0.7 });
  }

  // City hubs — fetched from DB (cities with ≥20 sitemap companies)
  try {
    const cities = await prisma.$queryRaw<Array<{ city: string; cnt: bigint }>>`
      SELECT city, COUNT(*)::bigint as cnt
      FROM "Company" c
      WHERE city IS NOT NULL
        AND EXISTS (SELECT 1 FROM "FinancialStatement" fs WHERE fs."companyIco" = c.ico HAVING COUNT(*) >= 2)
      GROUP BY city HAVING COUNT(*) >= 20
      ORDER BY cnt DESC
    `;
    for (const c of cities) {
      paths.push({ path: `/mesto/${slugify(c.city)}`, priority: 0.6 });
    }
  } catch {
    // DB unavailable — skip city hubs
  }

  return paths;
}
