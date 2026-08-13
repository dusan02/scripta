import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { seedFromOrsr } from "@/lib/orsr";

// ═══════════════════════════════════════════════════════════════
// RÚZ API client
// ═══════════════════════════════════════════════════════════════

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_STMTS = 5;

async function ruzGet<T = any>(endpoint: string, params: Record<string, string | number>): Promise<T | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (r.ok) return await r.json() as T;
    console.warn(`[ruzGet] ${endpoint} returned ${r.status}`);
    return null;
  } catch (e) {
    console.warn(`[ruzGet] ${endpoint} failed:`, e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Value parsing
// ═══════════════════════════════════════════════════════════════

function toFloat(val: unknown): number | null {
  if (val === null || val === undefined || val === "" || val === " ") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  if (typeof val === "string") {
    let c = val.trim();
    if (!c) return null;
    let neg = false;
    if (c.startsWith("(") && c.endsWith(")")) { neg = true; c = c.slice(1, -1).trim(); }
    c = c.replace(/[\s\xa0]/g, "");
    if (c.includes(",") && c.includes(".")) {
      if (c.lastIndexOf(",") > c.lastIndexOf(".")) c = c.replace(/\./g, "").replace(",", ".");
      else c = c.replace(/,/g, "");
    } else if (c.includes(",")) {
      c = c.replace(",", ".");
    }
    if ((c.match(/\./g) || []).length > 1) {
      const p = c.split(".");
      c = p.slice(0, -1).join("") + "." + p[p.length - 1];
    }
    const r = parseFloat(c);
    if (isNaN(r)) return null;
    return neg ? -r : r;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Table extraction — šablóna 699 (Súvaha + Výkaz ziskov a strát)
//
// RÚZ API returns `obsah.tabulky` as a flat array of strings:
//   data: ["val1", "val2", "", "val3", ...]
// Each index = one row (1-indexed in the official form).
// Only šablóna 699 has structured data; all others return empty.
// ═══════════════════════════════════════════════════════════════

interface RuzTable {
  nazov?: { sk?: string };
  data: unknown[];
}

interface ParsedTables {
  aktiv: RuzTable;
  pasiv: RuzTable;
  income: RuzTable | null;
}

function identifyTables(tables: RuzTable[]): ParsedTables | null {
  let aktiv = -1, pasiv = -1, income = -1;
  for (let i = 0; i < tables.length; i++) {
    const n = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (n.includes("strana akt") || n.includes("aktív") || (n.includes("akt") && !n.includes("pas"))) aktiv = i;
    else if (n.includes("strana pas") || n.includes("pasív") || n.includes("pas")) pasiv = i;
    else if (n.includes("ziskov a str") || n.includes("profit and loss")) income = i;
  }
  if (aktiv === -1 || pasiv === -1) return null;
  return {
    aktiv: tables[aktiv],
    pasiv: tables[pasiv],
    income: income !== -1 ? tables[income] : null,
  };
}

/** Extract value at 1-indexed row from a flat-data table. */
function val(table: RuzTable | null, row: number): number | null {
  if (!table?.data || !Array.isArray(table.data)) return null;
  const idx = row - 1;
  if (idx < 0 || idx >= table.data.length) return null;
  return toFloat(table.data[idx]);
}

// ═══════════════════════════════════════════════════════════════
// Row mappings (šablóna 699)
// ═══════════════════════════════════════════════════════════════

const AKTIV_ROWS = {
  totalAssets: 1,
  currentAssets: 33,
  inventory: 34,
  tradeReceivables: 54,
  cashAndEquivalents: 72,
} as const;

const PASIV_ROWS = {
  equity: 3,
  shortTermLiabilities: 85,
  tradePayables: 87,
  longTermLiabilities: 89,
  employeeLiabilities: 91,
  socialInsuranceLiabilities: 95,
  taxLiabilities: 109,
} as const;

const INCOME_ROWS = {
  mainActivityRevenue: 1,
  costOfGoodsSold: 10,
  staffCosts: 15,
  depreciationOld: 21,
  depreciation: 27,
  grossProfit: 28,
  interestExpense: 49,
  profitBeforeTax: 111,
  incomeTax: 113,
  netProfitLoss: 121,
} as const;

// ═══════════════════════════════════════════════════════════════
// Parsed financial statement
// ═══════════════════════════════════════════════════════════════

interface ParsedStatement {
  year: number;
  ruzZavierkaId: number | null;
  ruzVykazId: number | null;
  totalAssets: number | null;
  currentAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
  mainActivityRevenue: number | null;
  grossProfit: number | null;
  netProfitLoss: number | null;
  cashAndEquivalents: number | null;
  operatingCashFlow: number | null;
  staffCosts: number | null;
  tradeReceivables: number | null;
  tradePayables: number | null;
  inventory: number | null;
  depreciation: number | null;
  interestExpense: number | null;
  incomeTax: number | null;
  profitBeforeTax: number | null;
  socialInsuranceLiabilities: number | null;
  taxLiabilities: number | null;
  employeeLiabilities: number | null;
  statementType: string;
  monthsInPeriod: number;
  isConsolidated: boolean;
}

function parseStatement(
  year: number,
  zavierkaId: number | null,
  vykazId: number | null,
  tables: ParsedTables,
): ParsedStatement {
  const { aktiv, pasiv, income } = tables;
  const hasIncome = income !== null;

  // ── Aktíva ──
  const totalAssets = val(aktiv, AKTIV_ROWS.totalAssets);
  const currentAssets = val(aktiv, AKTIV_ROWS.currentAssets);
  const inventory = val(aktiv, AKTIV_ROWS.inventory);
  const tradeReceivables = val(aktiv, AKTIV_ROWS.tradeReceivables);
  const cashAndEquivalents = val(aktiv, AKTIV_ROWS.cashAndEquivalents);

  // ── Pasíva ──
  const equity = val(pasiv, PASIV_ROWS.equity);
  const shortTermLiabilities = val(pasiv, PASIV_ROWS.shortTermLiabilities);
  const tradePayables = val(pasiv, PASIV_ROWS.tradePayables);
  const longTermLiabilities = val(pasiv, PASIV_ROWS.longTermLiabilities);
  const employeeLiabilities = val(pasiv, PASIV_ROWS.employeeLiabilities);
  const socialInsuranceLiabilities = val(pasiv, PASIV_ROWS.socialInsuranceLiabilities);
  const taxLiabilities = val(pasiv, PASIV_ROWS.taxLiabilities);

  // ── Výkaz ziskov a strát ──
  const mainActivityRevenue = hasIncome ? val(income, INCOME_ROWS.mainActivityRevenue) : null;
  const cogs = hasIncome ? val(income, INCOME_ROWS.costOfGoodsSold) : null;
  const staffCosts = hasIncome ? val(income, INCOME_ROWS.staffCosts) : null;
  const depreciation = hasIncome
    ? (val(income, INCOME_ROWS.depreciation) ?? val(income, INCOME_ROWS.depreciationOld))
    : null;
  const grossProfit = hasIncome
    ? (mainActivityRevenue !== null && cogs !== null
      ? mainActivityRevenue - cogs
      : val(income, INCOME_ROWS.grossProfit))
    : null;
  const interestExpense = hasIncome ? val(income, INCOME_ROWS.interestExpense) : null;
  const profitBeforeTax = hasIncome ? val(income, INCOME_ROWS.profitBeforeTax) : null;
  const incomeTax = hasIncome ? val(income, INCOME_ROWS.incomeTax) : null;
  const netProfitLoss = hasIncome ? val(income, INCOME_ROWS.netProfitLoss) : null;

  // ── Operating cash flow (simplified indirect method) ──
  let operatingCashFlow: number | null = null;
  if (netProfitLoss !== null && depreciation !== null) {
    operatingCashFlow = netProfitLoss + depreciation;
  }

  return {
    year,
    ruzZavierkaId: zavierkaId,
    ruzVykazId: vykazId,
    totalAssets,
    currentAssets,
    equity,
    shortTermLiabilities,
    longTermLiabilities,
    mainActivityRevenue,
    grossProfit,
    netProfitLoss,
    cashAndEquivalents,
    operatingCashFlow,
    staffCosts,
    tradeReceivables,
    tradePayables,
    inventory,
    depreciation,
    interestExpense,
    incomeTax,
    profitBeforeTax,
    socialInsuranceLiabilities,
    taxLiabilities,
    employeeLiabilities,
    statementType: "SK_GAAP",
    monthsInPeriod: 12,
    isConsolidated: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// Lookup maps
// ═══════════════════════════════════════════════════════════════

const LF_MAP: Record<string, string> = {
  "112": "s.r.o.", "121": "a.s.", "113": "v.o.s.", "114": "k.s.",
  "101": "fyzická osoba", "107": "živnostník",
  "115": "európske združenie hospodárskych záujmov",
  "116": "európska spoločnosť", "117": "európske družstvo",
  "118": "družstvo", "119": "štátny podnik", "120": "rozpočtová organizácia",
  "122": "príspevková organizácia", "123": "nezisková organizácia",
  "124": "občianske združenie", "125": "nadácia", "126": "fond",
  "127": "nezisková organizácia poskytujúca všeobecne prospešné služby",
};

const OWNERSHIP_MAP: Record<string, string> = {
  "1": "Súkromné domáce", "2": "Súkromné zahraničné",
  "3": "Zmiešané", "4": "Verejné", "5": "Spoločné",
  "6": "Dánske", "7": "Zahraničné",
};

const SIZE_MAP: Record<string, string> = {
  "10": "Mikro", "11": "Mikro", "20": "Malá", "21": "Malá",
  "22": "Stredná", "23": "Stredná", "30": "Veľká", "31": "Veľká",
  "32": "Veľká", "33": "Veľká",
};

// ═══════════════════════════════════════════════════════════════
// DB helpers
// ═══════════════════════════════════════════════════════════════

function nonNullUpdate(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// Seed function
// ═══════════════════════════════════════════════════════════════

export async function seedFromRuz(ico: string) {
  // 1. Fetch accounting entity
  const eids = await ruzGet<{ id: number[] }>("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico, "max-zaznamov": 10 });
  if (!eids?.id?.length) return null;
  const entityId = eids.id[0];

  const entity = await ruzGet<any>("uctovna-jednotka", { id: entityId });
  if (!entity) return null;

  // 2. Fetch all zavierky, sorted newest first
  const zavierkaIds: number[] = entity.idUctovnychZavierok || [];
  const zavierky: any[] = [];
  for (const zid of zavierkaIds) {
    const z = await ruzGet<any>("uctovna-zavierka", { id: zid });
    if (z) zavierky.push(z);
  }
  zavierky.sort((a, b) => (b.obdobieDo || "").localeCompare(a.obdobieDo || ""));

  // 3. Parse financial statements (max 5, one per year)
  const stmts: ParsedStatement[] = [];
  const seenYears = new Set<number>();

  for (const z of zavierky) {
    if (stmts.length >= MAX_STMTS) break;

    const year = parseInt((z.obdobieDo || "").match(/20\d{2}/)?.[0] || "0");
    if (!year || seenYears.has(year)) continue;
    seenYears.add(year);

    let parsedTables: ParsedTables | null = null;
    let ruzVykazId: number | null = null;

    for (const vid of (z.idUctovnychVykazov || [])) {
      const v = await ruzGet<any>("uctovny-vykaz", { id: vid });
      if (!v?.obsah?.tabulky?.length) continue;
      const pt = identifyTables(v.obsah.tabulky);
      if (pt) {
        parsedTables = pt;
        ruzVykazId = vid;
        break;
      }
    }

    if (!parsedTables) continue;

    stmts.push(parseStatement(year, z.id || null, ruzVykazId, parsedTables));
  }

  // 4. Update company record
  let naceText: string | null = null;
  if (entity.skNace) {
    const nace = await prisma.naceCode.findUnique({ where: { code: entity.skNace } });
    naceText = nace?.description || null;
  }

  const companyData = {
    name: entity.nazovUJ || null,
    legalForm: LF_MAP[entity.pravnaForma] || entity.pravnaForma || null,
    city: entity.mesto || null,
    street: entity.ulica || null,
    zipCode: entity.psc || null,
    country: entity.krajina || "Slovensko",
    establishedAt: entity.datumZalozenia ? new Date(entity.datumZalozenia) : null,
    status: "active",
    naceCode: entity.skNace || null,
    naceText,
    ownershipType: OWNERSHIP_MAP[entity.druhVlastnictva] || entity.druhVlastnictva || null,
    sizeCategory: SIZE_MAP[entity.velkostOrganizacie] || entity.velkostOrganizacie || null,
    employeeCount: entity.pocetZamestnancov ?? null,
    ruzEntityId: entityId,
    ruzSyncedAt: new Date(),
  };

  await prisma.company.upsert({
    where: { ico },
    create: { ico, ...companyData },
    update: nonNullUpdate(companyData),
  });

  // 5. Upsert financial statements (preserve existing non-null values)
  for (const s of stmts) {
    const { year: _y, ruzZavierkaId: _rz, ruzVykazId: _rv, ...stmtData } = s;
    await prisma.financialStatement.upsert({
      where: { companyIco_year: { companyIco: ico, year: s.year } },
      create: { companyIco: ico, ...s },
      update: nonNullUpdate(stmtData),
    });
  }

  // 6. Update latest-year summary on company
  if (stmts.length > 0) {
    const latest = stmts[0];
    await prisma.company.update({
      where: { ico },
      data: {
        latestYear: latest.year,
        latestRevenue: latest.mainActivityRevenue ?? null,
        latestProfit: latest.netProfitLoss ?? null,
        latestAssets: latest.totalAssets ?? null,
        latestEquity: latest.equity ?? null,
      },
    });
  }

  // 7. Return updated company with relations
  return await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: { orderBy: { year: "desc" }, take: 5 },
      vestnikEvents: { orderBy: { publishedAt: "desc" }, take: 10 },
      companyPersons: { orderBy: { rawName: "asc" }, take: 50 },
      companyEvents: { where: { source: { in: ["ORSR", "VESTNIK"] }, eventType: { not: "FORENSIC_ANALYSIS" } }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// Seeding orchestration
// ═══════════════════════════════════════════════════════════════

async function seedCompany(ico: string) {
  await Promise.allSettled([
    seedFromRuz(ico),
    seedFromOrsr(ico),
  ]);

  return await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: { orderBy: { year: "desc" }, take: 5 },
      vestnikEvents: { orderBy: { publishedAt: "desc" }, take: 10 },
      companyPersons: { orderBy: { rawName: "asc" }, take: 50 },
      companyEvents: { where: { source: { in: ["ORSR", "VESTNIK"] }, eventType: { not: "FORENSIC_ANALYSIS" } }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
}

export const getCompanyData = cache(async (ico: string) => {
  let company = await prisma.company.findUnique({
    where: { ico },
    include: {
      financialStatements: { orderBy: { year: "desc" }, take: 5 },
      vestnikEvents: { orderBy: { publishedAt: "desc" }, take: 10 },
      companyPersons: { orderBy: { rawName: "asc" }, take: 50 },
      companyEvents: { where: { source: { in: ["ORSR", "VESTNIK"] }, eventType: { not: "FORENSIC_ANALYSIS" } }, orderBy: { createdAt: "desc" }, take: 10 },
    },
  });

  if (!company) {
    try {
      company = await seedCompany(ico);
    } catch {
      // ignore seeding errors
    }
  }

  return company;
});
