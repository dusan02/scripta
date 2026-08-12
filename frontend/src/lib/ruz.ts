import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { seedFromOrsr } from "@/lib/orsr";

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

const ACTIV_OFFSET = 1;
const PASIV_OFFSET = 79;
const INCOME_OFFSET = 1;

// ── Parsing helpers ──

function toFloat(val: any): number | null {
  if (val === null || val === undefined || val === "" || val === " ") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    let c = val.trim();
    if (!c) return null;
    let neg = false;
    if (c.startsWith("(") && c.endsWith(")")) { neg = true; c = c.slice(1, -1).trim(); }
    c = c.replace(/[\s\xa0]/g, "");
    if (c.includes(",") && c.includes(".")) {
      if (c.lastIndexOf(",") > c.lastIndexOf(".")) c = c.replace(/\./g, "").replace(",", ".");
      else c = c.replace(/,/g, "");
    } else if (c.includes(",")) c = c.replace(",", ".");
    if ((c.match(/\./g) || []).length > 1) {
      const p = c.split("."); c = p.slice(0, -1).join("") + "." + p[p.length - 1];
    }
    const r = parseFloat(c);
    if (isNaN(r)) return null;
    return neg ? -r : r;
  }
  return null;
}

function getRow(tables: any[], idx: number, cislo: number, offset: number, cols: number): any[] | null {
  if (idx >= tables.length) return null;
  const data = tables[idx]?.data;
  if (!data || !Array.isArray(data)) return null;
  const i = cislo - offset;
  if (i < 0 || i >= data.length) return null;
  const row = data[i];
  if (Array.isArray(row)) return row;
  if (cols > 0) {
    const s = i * cols;
    if (s + cols <= data.length) return data.slice(s, s + cols);
  }
  return null;
}

function activVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 0, r, ACTIV_OFFSET, 4);
  if (!row) return null;
  const tgt = cur ? 2 : 3;
  const ds = row.length > 4 ? row.length - 4 : 0;
  return toFloat(row[ds + tgt]);
}

function pasivVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 1, r, PASIV_OFFSET, 2);
  if (!row) return null;
  const tgt = cur ? 0 : 1;
  const ds = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[ds + tgt]);
}

function incomeVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 2, r, INCOME_OFFSET, 2);
  if (!row) return null;
  const tgt = cur ? 0 : 1;
  const ds = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[ds + tgt]);
}

function identifyTables(tables: any[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    const n = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (n.includes("strana akt") || n.includes("aktív") || (n.includes("akt") && !n.includes("pas"))) r.aktiv = i;
    else if (n.includes("strana pas") || n.includes("pasív") || n.includes("pas")) r.pasiv = i;
    else if (n.includes("ziskov a str") || n.includes("profit and loss")) r.income = i;
  }
  return r;
}

async function ruzGet(endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (r.ok) return await r.json();
    return null;
  } catch { return null; }
}

// ── Lookup maps ──

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

// ── Seed function ──

export async function seedFromRuz(ico: string) {
  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico, "max-zaznamov": 10 });
  if (!eids?.id?.length) return null;
  const entityId = eids.id[0];
  const entity = await ruzGet("uctovna-jednotka", { id: entityId });
  if (!entity) return null;

  const zavierkaIds: number[] = entity.idUctovnychZavierok || [];
  const zavierky: any[] = [];
  for (const zid of zavierkaIds) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (z) zavierky.push(z);
  }
  zavierky.sort((a, b) => (b.obdobieDo || "").localeCompare(a.obdobieDo || ""));

  const stmts: any[] = [];
  const seenYears = new Set<number>();
  for (const z of zavierky) {
    if (stmts.length >= 5) break;
    const year = parseInt((z.obdobieDo || "").match(/20\d{2}/)?.[0] || "0");
    if (!year || seenYears.has(year)) continue;
    seenYears.add(year);

    const allTables: any[] = [];
    let ruzVykazId: number | null = null;
    for (const vid of (z.idUctovnychVykazov || [])) {
      const v = await ruzGet("uctovny-vykaz", { id: vid });
      if (v?.obsah?.tabulky) { allTables.push(...v.obsah.tabulky); ruzVykazId = vid; }
    }
    if (!allTables.length) continue;

    const tm = identifyTables(allTables);
    if (tm.aktiv === undefined || tm.pasiv === undefined) continue;

    const ordered = [allTables[tm.aktiv], allTables[tm.pasiv]];
    if (tm.income !== undefined) ordered.push(allTables[tm.income]);
    const hasIncome = ordered.length > 2;

    const zasobyPrev = activVal(ordered, 34, false);
    const pohladavkyPrev = activVal(ordered, 54, false);
    const zavazkyPrev = pasivVal(ordered, 123, false);

    const zasoby = activVal(ordered, 34);
    const pohladavky = activVal(ordered, 54);
    const zavazkyObchod = pasivVal(ordered, 123);
    const zisk = hasIncome ? incomeVal(ordered, 61) : null;
    const odpisy = hasIncome ? incomeVal(ordered, 21) : null;
    const trzby = hasIncome ? incomeVal(ordered, 1) : null;
    const cogs = hasIncome ? incomeVal(ordered, 10) : null;

    let ocf: number | null = null;
    if (zisk !== null && odpisy !== null) {
      ocf = zisk + odpisy;
      if (zasoby !== null && zasobyPrev !== null) ocf -= zasoby - zasobyPrev;
      if (pohladavky !== null && pohladavkyPrev !== null) ocf -= pohladavky - pohladavkyPrev;
      if (zavazkyObchod !== null && zavazkyPrev !== null) ocf += zavazkyObchod - zavazkyPrev;
    }

    let hrubaMarza: number | null = null;
    if (trzby !== null && cogs !== null) hrubaMarza = trzby - cogs;
    if (hrubaMarza === null && hasIncome) hrubaMarza = incomeVal(ordered, 28);

    stmts.push({
      year, totalAssets: activVal(ordered, 1), currentAssets: activVal(ordered, 33),
      equity: pasivVal(ordered, 80), shortTermLiabilities: pasivVal(ordered, 122),
      longTermLiabilities: pasivVal(ordered, 102), mainActivityRevenue: trzby,
      grossProfit: hrubaMarza, netProfitLoss: zisk, cashAndEquivalents: activVal(ordered, 72),
      operatingCashFlow: ocf, staffCosts: hasIncome ? incomeVal(ordered, 15) : null,
      tradeReceivables: pohladavky, tradePayables: zavazkyObchod, inventory: zasoby,
      depreciation: odpisy, interestExpense: hasIncome ? incomeVal(ordered, 49) : null,
      incomeTax: hasIncome ? incomeVal(ordered, 60) : null,
      socialInsuranceLiabilities: pasivVal(ordered, 132), taxLiabilities: pasivVal(ordered, 133),
      employeeLiabilities: pasivVal(ordered, 131), statementType: "SK_GAAP",
      monthsInPeriod: 12, isConsolidated: false,
      ruzZavierkaId: z.id || null, ruzVykazId,
    });
  }

  let naceText: string | null = null;
  if (entity.skNace) {
    const nace = await prisma.naceCode.findUnique({ where: { code: entity.skNace } });
    naceText = nace?.description || null;
  }

  const companyData = {
    name: entity.nazovUJ || null,
    legalForm: LF_MAP[entity.pravnaForma] || entity.pravnaForma || null,
    city: entity.mesto || null, street: entity.ulica || null,
    zipCode: entity.psc || null, country: entity.krajina || "Slovensko",
    establishedAt: entity.datumZalozenia ? new Date(entity.datumZalozenia) : null,
    status: "active", naceCode: entity.skNace || null,
    naceText,
    ownershipType: OWNERSHIP_MAP[entity.druhVlastnictva] || entity.druhVlastnictva || null,
    sizeCategory: SIZE_MAP[entity.velkostOrganizacie] || entity.velkostOrganizacie || null,
    employeeCount: entity.pocetZamestnancov ?? null,
    ruzEntityId: entityId,
    ruzSyncedAt: new Date(),
  };

  // Only update non-null fields — don't overwrite existing DB values with NULL
  const companyUpdate: Record<string, any> = {};
  for (const [k, v] of Object.entries(companyData)) {
    if (v !== null && v !== undefined) companyUpdate[k] = v;
  }

  await prisma.company.upsert({
    where: { ico },
    create: { ico, ...companyData },
    update: companyUpdate,
  });

  for (const s of stmts) {
    const { year: _year, ruzZavierkaId: _rz, ruzVykazId: _rv, ...stmtData } = s;
    // Only update non-null fields — don't overwrite existing DB values (e.g. from worker PDF scraping) with NULL
    const updateData: Record<string, any> = {};
    for (const [k, v] of Object.entries(stmtData)) {
      if (v !== null && v !== undefined) updateData[k] = v;
    }
    await prisma.financialStatement.upsert({
      where: { companyIco_year: { companyIco: ico, year: s.year } },
      create: { companyIco: ico, ...s },
      update: updateData,
    });
  }

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

async function seedCompany(ico: string) {
  // RÚZ + ORSR run in parallel — both support direct IČO lookup.
  // Vestník API doesn't support IČO filtering (requires full pagination), so it's
  // NOT included in auto-seed. Vestník events are populated by the worker during
  // paid report generation and will display if already in DB.
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
