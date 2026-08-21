import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

export type FirmyFilters = {
  odvetvie?: string;      // NACE section (A-U)
  velkost?: string;       // sizeCategory
  trzby?: string;         // revenue range
  zisk?: string;          // profit range
  lokalita?: string;      // city
  pravnaForma?: string;   // legalForm
  status?: string;        // status
};

export type FirmySort = {
  field: "nazov" | "trzby" | "zisk" | "mesto";
  dir: "asc" | "desc";
};

export type FirmyResult = {
  ico: string;
  name: string | null;
  naceText: string | null;
  sizeCategory: string | null;
  city: string | null;
  latestRevenue: string | null;
  latestProfit: string | null;
  latestYear: number | null;
};

export type FirmyResponse = {
  firms: FirmyResult[];
  total: number;
  page: number;
  totalPages: number;
};

const TRZBY_RANGES: Record<string, { min: number; max: number }> = {
  "0-100k": { min: 0, max: 100000 },
  "100k-1M": { min: 100000, max: 1000000 },
  "1M-10M": { min: 1000000, max: 10000000 },
  "10M-50M": { min: 10000000, max: 50000000 },
  "50M+": { min: 50000000, max: Infinity },
};

const ZISK_RANGES: Record<string, { min: number; max: number }> = {
  "strata": { min: -Infinity, max: 0 },
  "0-100k": { min: 0, max: 100000 },
  "100k-500k": { min: 100000, max: 500000 },
  "500k+": { min: 500000, max: Infinity },
};

export async function queryFirmy(
  filters: FirmyFilters,
  sort: FirmySort,
  page: number = 1
): Promise<FirmyResponse> {
  const where: Record<string, unknown> = {};

  // NACE section filter — lookup codes from NaceCode table by section
  if (filters.odvetvie) {
    const section = filters.odvetvie.toUpperCase();
    const codes = await prisma.naceCode.findMany({
      where: { section },
      select: { code: true },
    });
    if (codes.length > 0) {
      where.naceCode = { in: codes.map((c) => c.code) };
    } else {
      // No codes for this section — return empty
      where.naceCode = { in: [] };
    }
  }

  // Size category filter
  if (filters.velkost) {
    where.sizeCategory = { in: filters.velkost.split(",") };
  }

  // Revenue range filter
  if (filters.trzby) {
    const range = TRZBY_RANGES[filters.trzby];
    if (range) {
      where.latestRevenue = {
        gte: range.min,
        lt: range.max === Infinity ? undefined : range.max,
      };
    }
  }

  // Profit range filter
  if (filters.zisk) {
    const range = ZISK_RANGES[filters.zisk];
    if (range) {
      where.latestProfit = {
        gte: range.min === -Infinity ? undefined : range.min,
        lt: range.max === Infinity ? undefined : range.max,
      };
    }
  }

  // City filter
  if (filters.lokalita) {
    where.city = { in: filters.lokalita.split(",") };
  }

  // Legal form filter
  if (filters.pravnaForma) {
    where.legalForm = { in: filters.pravnaForma.split(",") };
  }

  // Status filter
  if (filters.status) {
    where.status = { in: filters.status.split(",") };
  }

  // Sorting — default: trzby DESC (uses Company_latestRevenue_desc_idx, ~1.4ms).
  // name ASC default would cause 16s full scan + sort on 518K rows (no index on name).
  // NULLs always go last so financial sorts don't show empty rows first.
  let orderBy: Record<string, unknown> = {};
  switch (sort.field) {
    case "nazov":
      orderBy = { name: sort.dir };
      break;
    case "zisk":
      orderBy = { latestProfit: { sort: sort.dir, nulls: "last" } };
      break;
    case "mesto":
      orderBy = { city: { sort: sort.dir, nulls: "last" } };
      break;
    default:
      orderBy = { latestRevenue: { sort: sort.dir, nulls: "last" } };
  }

  // Run sequentially to avoid exhausting Prisma connection pool (limit 5).
  const firms = await prisma.company.findMany({
    where,
    select: {
      ico: true,
      name: true,
      naceText: true,
      sizeCategory: true,
      city: true,
      latestRevenue: true,
      latestProfit: true,
      latestYear: true,
    },
    orderBy,
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Approximate count from pg_class — real COUNT on 518K rows takes 14-21s
  // (PostgreSQL prefers seq scan over index for COUNT even when index exists).
  // For filtered queries with selective filters (city, status, sizeCategory),
  // real count is fast — use it. For non-selective or no filters, use approximate.
  const hasFilters = Object.keys(where).length > 0;
  let total: number;
  if (!hasFilters) {
    const approx = await prisma.$queryRaw<Array<{ estimate: bigint }>>`
      SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Company'
    `;
    total = Number(approx[0]?.estimate ?? 0);
  } else {
    // Selective filters use index scan → fast count.
    // Non-selective filters (legalForm) cause seq scan → use approximate.
    const isSelectiveFilter = Object.keys(where).some(k =>
      ["city", "status", "sizeCategory", "naceCode", "latestRevenue", "latestProfit"].includes(k)
    );
    if (isSelectiveFilter) {
      total = await prisma.company.count({ where });
    } else {
      const approx = await prisma.$queryRaw<Array<{ estimate: bigint }>>`
        SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Company'
      `;
      total = Number(approx[0]?.estimate ?? 0);
    }
  }

  return {
    firms: firms.map((f) => ({
      ico: f.ico,
      name: f.name,
      naceText: f.naceText,
      sizeCategory: f.sizeCategory,
      city: f.city,
      latestRevenue: f.latestRevenue?.toString() ?? null,
      latestProfit: f.latestProfit?.toString() ?? null,
      latestYear: f.latestYear,
    })),
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  };
}

// Get distinct filter values for dropdowns.
// Reads from pre-computed materialized view (0.1ms vs 60s for 5× GROUP BY on 518K rows).
// The MV must be refreshed after seeding: REFRESH MATERIALIZED VIEW "FirmyFilterOptions"
export async function getFirmyFilterOptions() {
  const rows = await prisma.$queryRaw<Array<{
    nace_sections: Array<{ section: string; sectionName: string; cnt: number }> | null;
    size_categories: Array<{ sizeCategory: string; cnt: number }>;
    cities: Array<{ city: string; cnt: number }>;
    legal_forms: Array<{ legalForm: string; cnt: number }>;
    statuses: Array<{ status: string; cnt: number }>;
  }>>`SELECT * FROM "FirmyFilterOptions" LIMIT 1`;

  const r = rows[0];
  return {
    naceSections: (r?.nace_sections || []).map((s) => ({
      value: s.section,
      label: `${s.section} — ${s.sectionName}`,
      count: Number(s.cnt),
    })),
    sizeCategories: (r?.size_categories || []).map((s) => ({
      value: s.sizeCategory,
      label: s.sizeCategory,
      count: Number(s.cnt),
    })),
    cities: (r?.cities || []).map((c) => ({
      value: c.city,
      label: c.city,
      count: Number(c.cnt),
    })),
    legalForms: (r?.legal_forms || []).map((l) => ({
      value: l.legalForm,
      label: l.legalForm,
      count: Number(l.cnt),
    })),
    statuses: (r?.statuses || []).map((s) => ({
      value: s.status,
      label: s.status === "active" ? "Aktívna" : s.status,
      count: Number(s.cnt),
    })),
    revenueRanges: Object.entries(TRZBY_RANGES).map(([key, r]) => ({
      value: key,
      label: key === "0-100k" ? "< €100k" : key === "100k-1M" ? "€100k – €1M" : key === "1M-10M" ? "€1M – €10M" : key === "10M-50M" ? "€10M – €50M" : "> €50M",
    })),
    profitRanges: Object.entries(ZISK_RANGES).map(([key, r]) => ({
      value: key,
      label: key === "strata" ? "Strata" : key === "0-100k" ? "€0 – €100k" : key === "100k-500k" ? "€100k – €500k" : "> €500k",
    })),
  };
}
