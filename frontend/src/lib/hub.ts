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

/**
 * Get company count for a hub — used for thin hub detection.
 * Uses fsCount column (pre-computed ≥2 FS quality gate) for O(1) index lookup.
 */
export async function getHubCompanyCount(params: HubParams): Promise<number> {
  const conditions: string[] = [`"fsCount" >= 2`];
  const replacements: unknown[] = [];

  if (params.section) {
    const range = naceSectionToPrefixFilter(params.section);
    if (range) {
      conditions.push(`"naceCode" >= $${replacements.length + 1} AND "naceCode" < $${replacements.length + 2}`);
      replacements.push(range.gte, range.lt);
    }
  }

  if (params.kraj) {
    conditions.push(`kraj = $${replacements.length + 1}`);
    replacements.push(params.kraj);
  }

  if (params.okres) {
    conditions.push(`okres = $${replacements.length + 1}`);
    replacements.push(params.okres);
  }

  if (params.city) {
    conditions.push(`city = $${replacements.length + 1}`);
    replacements.push(params.city);
  }

  try {
    const result = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*)::bigint as cnt FROM "Company" WHERE ${conditions.join(" AND ")}`,
      ...replacements
    );
    return Number(result[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

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
 * Uses fsCount column (pre-computed ≥2 FS quality gate) for O(50) index seek.
 * Uses composite indexes (kraj, fsCount, latestRevenue DESC) etc.
 */
export async function queryHubCompanies(
  params: HubParams,
  page: number = 1
): Promise<HubResult | null> {
  const hubType = getHubType(params);
  const hubLabel = getHubLabel(params);

  if (!hubType) return null;

  const offset = (page - 1) * PAGE_SIZE;

  // Build raw SQL query with quality gate using fsCount column
  const conditions: string[] = [`"fsCount" >= 2`];
  const replacements: unknown[] = [];

  if (params.section) {
    const range = naceSectionToPrefixFilter(params.section);
    if (range) {
      conditions.push(`"naceCode" >= $${replacements.length + 1} AND "naceCode" < $${replacements.length + 2}`);
      replacements.push(range.gte, range.lt);
    }
  }

  if (params.kraj) {
    conditions.push(`kraj = $${replacements.length + 1}`);
    replacements.push(params.kraj);
  }

  if (params.okres) {
    conditions.push(`okres = $${replacements.length + 1}`);
    replacements.push(params.okres);
  }

  if (params.city) {
    conditions.push(`city = $${replacements.length + 1}`);
    replacements.push(params.city);
  }

  const whereClause = conditions.join(" AND ");

  // Query companies — ordered by revenue DESC (uses composite index)
  const companies = await prisma.$queryRawUnsafe<Array<{
    ico: string; name: string | null; city: string | null;
    "naceText": string | null; "sizeCategory": string | null;
    "latestRevenue": bigint | null; "latestProfit": bigint | null;
    "latestYear": number | null;
  }>>(
    `SELECT ico, name, city, "naceText", "sizeCategory", "latestRevenue", "latestProfit", "latestYear"
     FROM "Company"
     WHERE ${whereClause}
     ORDER BY "latestRevenue" DESC NULLS LAST
     LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    ...replacements
  );

  // Count total — same WHERE but COUNT(*) instead of fetching rows
  const countResult = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*)::bigint as cnt FROM "Company" WHERE ${whereClause}`,
    ...replacements
  );
  const total = Number(countResult[0]?.cnt ?? 0);

  const totalPages = Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES);
  const subHubs = await getSubHubs(params, total);

  return {
    companies: companies.map((c) => ({
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
    const range = naceSectionToPrefixFilter(params.section);
    if (range) {
      const rows = await prisma.$queryRaw<Array<{ kraj: string; cnt: bigint }>>`
        SELECT kraj, COUNT(*)::bigint as cnt
        FROM "Company"
        WHERE "naceCode" >= ${range.gte} AND "naceCode" < ${range.lt}
          AND kraj IS NOT NULL
          AND "fsCount" >= 2
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
  }

  // If this is a kraj hub → show okres breakdown
  if (params.kraj && !params.section && !params.okres && !params.city) {
    const rows = await prisma.$queryRaw<Array<{ okres: string; cnt: bigint }>>`
      SELECT okres, COUNT(*)::bigint as cnt
      FROM "Company"
      WHERE kraj = ${params.kraj}
        AND okres IS NOT NULL
        AND "fsCount" >= 2
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
        WHERE "naceCode" >= ${range.gte} AND "naceCode" < ${range.lt}
          AND kraj = ${params.kraj}
          AND okres IS NOT NULL
          AND "fsCount" >= 2
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
        AND "fsCount" >= 2
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

// ── Hub page SEO metadata (i18n, all 6 languages) ───────────────────

type HubLang = "sk" | "en" | "de" | "cz" | "hu" | "pl";

/**
 * Hub SEO templates per language.
 * Titles ≤60 chars, descriptions ≤160 chars.
 * Placeholders: {label}, {section}, {genitive}, {locative}
 */
const HUB_SEO_TEMPLATES: Record<HubLang, {
  odvetvie: { title: string; desc: string };
  kraj: { title: string; desc: string };
  odvetvieKraj: { title: string; desc: string };
  okres: { title: string; desc: string };
  mesto: { title: string; desc: string };
}> = {
  sk: {
    odvetvie: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy v odvetví {genitive} (NACE {section}) — tržby, zisk, aktíva a finančné dáta z registrov SR.",
    },
    kraj: {
      title: "Firmy v {locative} | Verifa.sk",
      desc: "Firmy v {locative} — tržby, zisk, aktíva a finančné dáta z verejných registrov SR.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Firmy v odvetví {section} v {locative} — tržby, zisk a finančné dáta z registrov SR.",
    },
    okres: {
      title: "Firmy — okres {label} | Verifa.sk",
      desc: "Firmy v okrese {label} — tržby, zisk, aktíva a finančné dáta z verejných registrov SR.",
    },
    mesto: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy v meste {label} — tržby, zisk, aktíva a finančné dáta z registrov SR (RÚZ, ORSR).",
    },
  },
  en: {
    odvetvie: {
      title: "Companies — {label} | Verifa.sk",
      desc: "Companies in {genitive} (NACE {section}) — revenue, profit, assets and financial data from Slovak registries.",
    },
    kraj: {
      title: "Companies in {locative} | Verifa.sk",
      desc: "Companies in {locative} — revenue, profit, assets and financial data from Slovak public registries.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Companies in {section} in {locative} — revenue, profit and financial data from Slovak registries.",
    },
    okres: {
      title: "Companies — {label} district | Verifa.sk",
      desc: "Companies in {label} district — revenue, profit, assets and financial data from Slovak registries.",
    },
    mesto: {
      title: "Companies — {label} | Verifa.sk",
      desc: "Companies in {label} — revenue, profit, assets and financial data from Slovak registries (RÚZ, ORSR).",
    },
  },
  de: {
    odvetvie: {
      title: "Firmen — {label} | Verifa.sk",
      desc: "Firmen in {genitive} (NACE {section}) — Umsatz, Gewinn, Aktiva und Finanzdaten aus slowakischen Registern.",
    },
    kraj: {
      title: "Firmen in {locative} | Verifa.sk",
      desc: "Firmen in {locative} — Umsatz, Gewinn, Aktiva und Finanzdaten aus slowakischen Registern.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Firmen in {section} in {locative} — Umsatz, Gewinn und Finanzdaten aus slowakischen Registern.",
    },
    okres: {
      title: "Firmen — Bezirk {label} | Verifa.sk",
      desc: "Firmen im Bezirk {label} — Umsatz, Gewinn, Aktiva und Finanzdaten aus slowakischen Registern.",
    },
    mesto: {
      title: "Firmen — {label} | Verifa.sk",
      desc: "Firmen in {label} — Umsatz, Gewinn, Aktiva und Finanzdaten aus slowakischen Registern (RÚZ, ORSR).",
    },
  },
  cz: {
    odvetvie: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy v odvětví {genitive} (NACE {section}) — tržby, zisk, aktiva a finanční data z registrů SR.",
    },
    kraj: {
      title: "Firmy v {locative} | Verifa.sk",
      desc: "Firmy v {locative} — tržby, zisk, aktiva a finanční data z veřejných registrů SR.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Firmy v odvětví {section} v {locative} — tržby, zisk a finanční data z registrů SR.",
    },
    okres: {
      title: "Firmy — okres {label} | Verifa.sk",
      desc: "Firmy v okrese {label} — tržby, zisk, aktiva a finanční data z veřejných registrů SR.",
    },
    mesto: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy ve městě {label} — tržby, zisk, aktiva a finanční data z registrů SR (RÚZ, ORSR).",
    },
  },
  hu: {
    odvetvie: {
      title: "Cégek — {label} | Verifa.sk",
      desc: "Cégek a(z) {genitive} (NACE {section}) — árbevétel, profit, eszközök és pénzügyi adatok szlovák nyilvántartásokból.",
    },
    kraj: {
      title: "Cégek {locative} | Verifa.sk",
      desc: "Cégek {locative} — árbevétel, profit, eszközök és pénzügyi adatok szlovák nyilvántartásokból.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Cégek a(z) {section} {locative} — árbevétel, profit és pénzügyi adatok szlovák nyilvántartásokból.",
    },
    okres: {
      title: "Cégek — {label} járás | Verifa.sk",
      desc: "Cégek a(z) {label} járásban — árbevétel, profit, eszközök és pénzügyi adatok szlovák nyilvántartásokból.",
    },
    mesto: {
      title: "Cégek — {label} | Verifa.sk",
      desc: "Cégek {label} városában — árbevétel, profit, eszközök és pénzügyi adatok szlovák nyilvántartásokból.",
    },
  },
  pl: {
    odvetvie: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy w {genitive} (NACE {section}) — przychody, zysk, aktywa i dane finansowe ze słowackich rejestrów.",
    },
    kraj: {
      title: "Firmy w {locative} | Verifa.sk",
      desc: "Firmy w {locative} — przychody, zysk, aktywa i dane finansowe ze słowackich rejestrów publicznych.",
    },
    odvetvieKraj: {
      title: "{label} | Verifa.sk",
      desc: "Firmy w {section} w {locative} — przychody, zysk i dane finansowe ze słowackich rejestrów.",
    },
    okres: {
      title: "Firmy — powiat {label} | Verifa.sk",
      desc: "Firmy w powiecie {label} — przychody, zysk, aktywa i dane finansowe ze słowackich rejestrów.",
    },
    mesto: {
      title: "Firmy — {label} | Verifa.sk",
      desc: "Firmy w mieście {label} — przychody, zysk, aktywa i dane finansowe ze słowackich rejestrów (RÚZ, ORSR).",
    },
  },
};

// Locative forms of kraj per language (for "in {region}" phrases)
const KRAJ_LOCATIVE_I18N: Record<HubLang, Record<string, string>> = {
  sk: {
    "SK010": "Bratislavskom kraji", "SK021": "Trnavskom kraji", "SK022": "Nitrianskom kraji",
    "SK023": "Trenčianskom kraji", "SK031": "Žilinskom kraji", "SK032": "Banskobystrickom kraji",
    "SK041": "Prešovskom kraji", "SK042": "Košickom kraji",
  },
  en: {
    "SK010": "Bratislava region", "SK021": "Trnava region", "SK022": "Nitra region",
    "SK023": "Trenčín region", "SK031": "Žilina region", "SK032": "Banská Bystrica region",
    "SK041": "Prešov region", "SK042": "Košice region",
  },
  de: {
    "SK010": "der Bratislava-Region", "SK021": "der Trnava-Region", "SK022": "der Nitra-Region",
    "SK023": "der Trenčín-Region", "SK031": "der Žilina-Region", "SK032": "der Banská Bystrica-Region",
    "SK041": "der Prešov-Region", "SK042": "der Košice-Region",
  },
  cz: {
    "SK010": "Bratislavském kraji", "SK021": "Trnavském kraji", "SK022": "Nitrianském kraji",
    "SK023": "Trenčianském kraji", "SK031": "Žilinském kraji", "SK032": "Banskobystrickém kraji",
    "SK041": "Prešovském kraji", "SK042": "Košickém kraji",
  },
  hu: {
    "SK010": "Pozsony kerületben", "SK021": "Nagyszombat kerületben", "SK022": "Nyitra kerületben",
    "SK023": "Trencsén kerületben", "SK031": "Zsolna kerületben", "SK032": "Besztercebánya kerületben",
    "SK041": "Eperjes kerületben", "SK042": "Kassa kerületben",
  },
  pl: {
    "SK010": "kraju bratysławskim", "SK021": "kraju trnawskim", "SK022": "kraju nitrzańskim",
    "SK023": "kraju trenczyńskim", "SK031": "kraju żylińskim", "SK032": "kraju bańskobystrzyckim",
    "SK041": "kraju preszowskim", "SK042": "kraju koszyckim",
  },
};

// NACE section labels per language (short forms for titles)
const NACE_LABEL_I18N: Record<HubLang, Record<string, string>> = {
  sk: {
    A: "Poľnohospodárstvo", B: "Ťažba", C: "Priemyselná výroba", D: "Energetika",
    E: "Vodné hospodárstvo", F: "Stavebníctvo", G: "Obchod", H: "Doprava",
    I: "Ubytovanie a stravovanie", J: "IT a telekomunikácie", K: "Financie",
    L: "Nehnuteľnosti", M: "Profesionálne služby", N: "Admin služby",
    O: "Verejná správa", P: "Vzdelávanie", Q: "Zdravotníctvo",
    R: "Kultúra a zábava", S: "Ostatné služby", T: "Domácnosti", U: "Extrateritoriálne",
  },
  en: {
    A: "Agriculture", B: "Mining", C: "Manufacturing", D: "Energy",
    E: "Water supply", F: "Construction", G: "Trade", H: "Transportation",
    I: "Accommodation & food", J: "IT & telecom", K: "Finance",
    L: "Real estate", M: "Professional services", N: "Admin services",
    O: "Public administration", P: "Education", Q: "Healthcare",
    R: "Arts & entertainment", S: "Other services", T: "Households", U: "Extraterritorial",
  },
  de: {
    A: "Landwirtschaft", B: "Bergbau", C: "Verarbeitendes Gewerbe", D: "Energie",
    E: "Wasserversorgung", F: "Bauwesen", G: "Handel", H: "Verkehr",
    I: "Gastgewerbe", J: "IT & Telekom", K: "Finanzen",
    L: "Immobilien", M: "Freiberufliche Dienste", N: "Verwaltungsdienste",
    O: "Öffentliche Verwaltung", P: "Bildung", Q: "Gesundheitswesen",
    R: "Kunst & Unterhaltung", S: "Sonstige Dienste", T: "Haushalte", U: "Extraterritorial",
  },
  cz: {
    A: "Zemědělství", B: "Těžba", C: "Průmyslová výroba", D: "Energetika",
    E: "Vodní hospodářství", F: "Stavebnictví", G: "Obchod", H: "Doprava",
    I: "Ubytování a stravování", J: "IT a telekomunikace", K: "Finance",
    L: "Nemovitosti", M: "Profesionální služby", N: "Admin služby",
    O: "Veřejná správa", P: "Vzdělávání", Q: "Zdravotnictví",
    R: "Kultura a zábava", S: "Ostatní služby", T: "Domácnosti", U: "Extrateritoriální",
  },
  hu: {
    A: "Mezőgazdaság", B: "Bányászat", C: "Feldolgozóipar", D: "Energia",
    E: "Vízgazdálkodás", F: "Építőipar", G: "Kereskedelem", H: "Közlekedés",
    I: "Szállás és vendéglátás", J: "IT és távközlés", K: "Pénzügy",
    L: "Ingatlan", M: "Szakmai szolgáltatások", N: "Admin szolgáltatások",
    O: "Közigazgatás", P: "Oktatás", Q: "Egészségügy",
    R: "Kultúra és szórakozás", S: "Egyéb szolgáltatások", T: "Háztartások", U: "Extraterritoriális",
  },
  pl: {
    A: "Rolnictwo", B: "Górnictwo", C: "Przemysł przetwórczy", D: "Energetyka",
    E: "Gospodarka wodna", F: "Budownictwo", G: "Handel", H: "Transport",
    I: "Noclegi i gastronomia", J: "IT i telekomunikacja", K: "Finanse",
    L: "Nieruchomości", M: "Usługi profesjonalne", N: "Usługi admin.",
    O: "Administracja publiczna", P: "Edukacja", Q: "Ochrona zdrowia",
    R: "Kultura i rozrywka", S: "Pozostałe usługi", T: "Gospodarstwa domowe", U: "Eksterytorialne",
  },
};

// Genitive forms of NACE sections per language (for "in {industry}" phrases)
const NACE_GENITIVE_I18N: Record<HubLang, Record<string, string>> = {
  sk: {
    A: "poľnohospodárstva", B: "ťažby", C: "priemyselnej výroby", D: "energetiky",
    E: "vodného hospodárstva", F: "stavebníctva", G: "obchodu", H: "dopravy",
    I: "ubytovania a stravovania", J: "IT a telekomunikácií", K: "financií",
    L: "nehnuteľností", M: "profesionálnych služieb", N: "admin služieb",
    O: "verejnej správy", P: "vzdelávania", Q: "zdravotníctva",
    R: "kultúry a zábavy", S: "ostatných služieb", T: "domácností", U: "extrateritoriálnych org.",
  },
  en: {
    A: "agriculture", B: "mining", C: "manufacturing", D: "energy",
    E: "water supply", F: "construction", G: "trade", H: "transportation",
    I: "accommodation & food", J: "IT & telecom", K: "finance",
    L: "real estate", M: "professional services", N: "admin services",
    O: "public administration", P: "education", Q: "healthcare",
    R: "arts & entertainment", S: "other services", T: "households", U: "extraterritorial org.",
  },
  de: {
    A: "Landwirtschaft", B: "Bergbau", C: "Verarbeitendes Gewerbe", D: "Energie",
    E: "Wasserversorgung", F: "Bauwesen", G: "Handel", H: "Verkehr",
    I: "Gastgewerbe", J: "IT & Telekom", K: "Finanzen",
    L: "Immobilien", M: "Freiberufliche Dienste", N: "Verwaltungsdienste",
    O: "Öffentliche Verwaltung", P: "Bildung", Q: "Gesundheitswesen",
    R: "Kunst & Unterhaltung", S: "Sonstige Dienste", T: "Haushalte", U: "Extraterritoriale Org.",
  },
  cz: {
    A: "zemědělství", B: "těžby", C: "průmyslové výroby", D: "energetiky",
    E: "vodního hospodářství", F: "stavebnictví", G: "obchodu", H: "dopravy",
    I: "ubytování a stravování", J: "IT a telekomunikací", K: "financí",
    L: "nemovitostí", M: "profesionálních služeb", N: "admin služeb",
    O: "veřejné správy", P: "vzdělávání", Q: "zdravotnictví",
    R: "kultury a zábavy", S: "ostatních služeb", T: "domácností", U: "extrateritoriálních org.",
  },
  hu: {
    A: "mezőgazdaság", B: "bányászat", C: "feldolgozóipar", D: "energia",
    E: "vízgazdálkodás", F: "építőipar", G: "kereskedelem", H: "közlekedés",
    I: "szállás és vendéglátás", J: "IT és távközlés", K: "pénzügy",
    L: "ingatlan", M: "szakmai szolgáltatások", N: "admin szolgáltatások",
    O: "közigazgatás", P: "oktatás", Q: "egészségügy",
    R: "kultúra és szórakozás", S: "egyéb szolgáltatások", T: "háztartások", U: "extraterritoriális szervek",
  },
  pl: {
    A: "rolnictwa", B: "górnictwa", C: "przemysłu przetwórczego", D: "energetyki",
    E: "gospodarki wodnej", F: "budownictwa", G: "handlu", H: "transportu",
    I: "noclegów i gastronomii", J: "IT i telekomunikacji", K: "finansów",
    L: "nieruchomości", M: "usług profesjonalnych", N: "usług admin.",
    O: "administracji publicznej", P: "edukacji", Q: "ochrony zdrowia",
    R: "kultury i rozrywki", S: "pozostałych usług", T: "gospodarstw domowych", U: "org. eksterytorialnych",
  },
};

function normalizeHubLang(lang: string): HubLang {
  if (lang === "sk" || lang === "en" || lang === "de" || lang === "cz" || lang === "hu" || lang === "pl") {
    return lang;
  }
  return "sk";
}

export function getHubMetadata(params: HubParams, lang: string): {
  title: string;
  description: string;
  canonical: string;
} {
  const hubType = getHubType(params);
  const l = normalizeHubLang(lang);
  const templates = HUB_SEO_TEMPLATES[l];

  // Build path
  let path = "/";
  if (hubType === "odvetvie") path = `/odvetvie/${params.section}`;
  else if (hubType === "kraj") path = `/kraj/${params.kraj}`;
  else if (hubType === "odvetvie-kraj") path = `/odvetvie/${params.section}/${params.kraj}`;
  else if (hubType === "okres") path = `/okres/${params.okres}`;
  else if (hubType === "mesto") path = `/mesto/${slugify(params.city)}`;

  // Get i18n labels
  const section = params.section || "";
  const naceLabel = section ? (NACE_LABEL_I18N[l][section] || getNaceSectionLabel(section) || section) : "";
  const naceGenitive = section ? (NACE_GENITIVE_I18N[l][section] || naceLabel) : "";
  const krajLocative = params.kraj ? (KRAJ_LOCATIVE_I18N[l][params.kraj] || getKrajLabelLocative(params.kraj) || getKrajLabel(params.kraj) || params.kraj) : "";
  const okresLabel = params.okres ? (okresName(params.okres)) : "";
  const cityLabel = params.city || "";

  let title: string;
  let description: string;

  if (hubType === "odvetvie") {
    const tpl = templates.odvetvie;
    title = tpl.title.replace("{label}", naceLabel);
    description = tpl.desc.replace("{genitive}", naceGenitive).replace("{section}", section);
  } else if (hubType === "kraj") {
    const tpl = templates.kraj;
    title = tpl.title.replace("{locative}", krajLocative);
    description = tpl.desc.replace("{locative}", krajLocative);
  } else if (hubType === "odvetvie-kraj") {
    const tpl = templates.odvetvieKraj;
    const combinedLabel = `${naceLabel} — ${krajLocative}`;
    title = tpl.title.replace("{label}", combinedLabel);
    description = tpl.desc.replace("{section}", naceLabel).replace("{locative}", krajLocative);
  } else if (hubType === "okres") {
    const tpl = templates.okres;
    title = tpl.title.replace("{label}", okresLabel);
    description = tpl.desc.replace("{label}", okresLabel);
  } else if (hubType === "mesto") {
    const tpl = templates.mesto;
    title = tpl.title.replace("{label}", cityLabel);
    description = tpl.desc.replace("{label}", cityLabel);
  } else {
    title = "Firmy na Slovensku | Verifa.sk";
    description = "Zoznam slovenských firiem s finančnými dátami z verejných registrov.";
  }

  // Canonical with language prefix
  const BASE_URL = "https://verifa.sk";
  const langPrefix = l === "sk" ? "" : l === "cz" ? "/cs" : `/${l}`;
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
 * Uses PostgreSQL unaccent + regexp_replace to compute slug in SQL,
 * avoiding fetching 3,961 cities and matching in JS.
 * Picks the city with the most companies if multiple match.
 */
export async function resolveCitySlug(slug: string): Promise<string | null> {
  // Use the CitySlugCache table for O(1) lookup instead of scanning 518k rows
  // with unaccent() + regexp_replace() on every request.
  // The cache is populated by the reseed-all cron and refresh-city-slug-cache script.
  // Fallback to the full scan only if the cache table is empty (cold start).
  const cached = await prisma.$queryRawUnsafe<Array<{ city: string }>>(
    `SELECT city FROM "CitySlugCache" WHERE slug = $1 LIMIT 1`,
    slug
  );
  if (cached.length > 0) return cached[0].city;

  // Cold start fallback — compute on the fly (slow, but only once per slug)
  const result = await prisma.$queryRawUnsafe<Array<{ city: string }>>(
    `SELECT city FROM (
       SELECT city,
         COUNT(*) as cnt,
         btrim(regexp_replace(lower(unaccent(city)), '[^a-z0-9]+', '-', 'g'), '-') as computed_slug
       FROM "Company"
       WHERE city IS NOT NULL AND city != ''
       GROUP BY city
     ) t
     WHERE computed_slug = $1
     ORDER BY cnt DESC
     LIMIT 1`,
    slug
  );
  return result[0]?.city ?? null;
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
  // Use a JOIN with a subquery to find companies with ≥2 FS — much faster than EXISTS+HAVING
  try {
    const cities = await prisma.$queryRaw<Array<{ city: string; cnt: bigint }>>`
      SELECT c.city, COUNT(*)::bigint as cnt
      FROM "Company" c
      INNER JOIN (
        SELECT "companyIco" FROM "FinancialStatement" GROUP BY "companyIco" HAVING COUNT(*) >= 2
      ) fs ON fs."companyIco" = c.ico
      WHERE c.city IS NOT NULL AND c.city != ''
      GROUP BY c.city HAVING COUNT(*) >= 20
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
