import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

// ── Row indices (cisloRiadku from template 699) ──
// Strana aktív (table 0)
const ROW_TOTAL_ASSETS = 1;
const ROW_CURRENT_ASSETS = 33;
const ROW_INVENTORY = 34;
const ROW_TRADE_RECEIVABLES = 54;
const ROW_CASH = 72;

// Strana pasív (table 1, offset 79)
const ROW_TOTAL_EQUITY = 80;
const ROW_LT_LIABILITIES = 102;
const ROW_ST_LIABILITIES = 122;
const ROW_TRADE_PAYABLES = 123;
const ROW_SOCIAL_INS_LIAB = 132;
const ROW_TAX_LIAB = 133;
const ROW_EMPLOYEE_LIAB = 131;

// Výkaz ziskov a strát (table 2)
const ROW_NET_REVENUE = 1;
const ROW_PERSONNEL_COSTS = 15;
const ROW_DEPRECIATION = 21;
const ROW_INTEREST_EXPENSE = 49;
const ROW_NET_PROFIT = 61;
const ROW_COGS = 10;
const ROW_VALUE_ADDED = 28;

const ACTIV_OFFSET = 1;
const PASIV_OFFSET = 79;
const INCOME_OFFSET = 1;

function toFloat(val: any): number | null {
  if (val === null || val === undefined || val === "" || val === " ") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    let cleaned = val.trim();
    if (!cleaned) return null;
    let isNegative = false;
    if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
      isNegative = true;
      cleaned = cleaned.slice(1, -1).trim();
    }
    cleaned = cleaned.replace(/[\s\xa0]/g, "");
    if (cleaned.includes(",") && cleaned.includes(".")) {
      const lastComma = cleaned.lastIndexOf(",");
      const lastDot = cleaned.lastIndexOf(".");
      if (lastComma > lastDot) {
        cleaned = cleaned.replace(/\./g, "").replace(",", ".");
      } else {
        cleaned = cleaned.replace(/,/g, "");
      }
    } else if (cleaned.includes(",")) {
      cleaned = cleaned.replace(",", ".");
    }
    if ((cleaned.match(/\./g) || []).length > 1) {
      const parts = cleaned.split(".");
      cleaned = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    }
    const result = parseFloat(cleaned);
    if (isNaN(result)) return null;
    return isNegative ? -result : result;
  }
  return null;
}

function getRow(tables: any[], tableIdx: number, cisloRiadku: number, offset: number, dataCols: number): any[] | null {
  if (tableIdx >= tables.length) return null;
  const data = tables[tableIdx]?.data;
  if (!data || !Array.isArray(data)) return null;
  const idx = cisloRiadku - offset;
  if (idx < 0 || idx >= data.length) return null;
  const row = data[idx];
  if (!row) return null;

  // Flat array detection
  if (!Array.isArray(row) && dataCols > 0) {
    const start = idx * dataCols;
    if (start + dataCols <= data.length) {
      return data.slice(start, start + dataCols);
    }
    return null;
  }
  return Array.isArray(row) ? row : null;
}

function getActivValue(tables: any[], cisloRiadku: number, current = true): number | null {
  const row = getRow(tables, 0, cisloRiadku, ACTIV_OFFSET, 4);
  if (!row) return null;
  const target = current ? 2 : 3; // Netto2 / Netto3
  const dataStart = row.length > 4 ? row.length - 4 : 0;
  return toFloat(row[dataStart + target]);
}

function getPasivValue(tables: any[], cisloRiadku: number, current = true): number | null {
  const row = getRow(tables, 1, cisloRiadku, PASIV_OFFSET, 2);
  if (!row) return null;
  const target = current ? 0 : 1;
  const dataStart = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[dataStart + target]);
}

function getIncomeValue(tables: any[], cisloRiadku: number, current = true): number | null {
  const row = getRow(tables, 2, cisloRiadku, INCOME_OFFSET, 2);
  if (!row) return null;
  const target = current ? 0 : 1;
  const dataStart = row.length > 2 ? row.length - 2 : 0;
  return toFloat(row[dataStart + target]);
}

function identifyTables(tables: any[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    const nazov = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (nazov.includes("strana akt") || nazov.includes("aktív") || (nazov.includes("akt") && !nazov.includes("pas"))) {
      result.aktiv = i;
    } else if (nazov.includes("strana pas") || nazov.includes("pasív") || nazov.includes("pas")) {
      result.pasiv = i;
    } else if (nazov.includes("ziskov a str") || nazov.includes("profit and loss") || nazov.includes("výsledovka")) {
      result.income = i;
    }
  }
  return result;
}

async function ruzGet(endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const resp = await fetch(url.toString(), { headers: { "User-Agent": UA } });
    if (resp.ok) return await resp.json();
    return null;
  } catch {
    return null;
  }
}

function extractYear(period: string): number | null {
  const m = period.match(/(20\d{2})/);
  return m ? parseInt(m[1]) : null;
}

async function seedCompany(ico: string) {
  // 1. Get entity ID
  const entityIds = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico, "max-zaznamov": 10 });
  if (!entityIds?.id?.length) return { success: false, error: "Entity not found in RÚZ" };

  const entityId = entityIds.id[0];

  // 2. Get entity details
  const entity = await ruzGet("uctovna-jednotka", { id: entityId });
  if (!entity) return { success: false, error: "Entity details not found" };

  // 3. Get all závierky
  const zavierkaIds: number[] = entity.idUctovnychZavierok || [];
  const zavierky: any[] = [];
  for (const zid of zavierkaIds) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (z) zavierky.push(z);
  }

  // Sort by period descending
  zavierky.sort((a, b) => {
    const pa = `${a.obdobieDo || ""}`;
    const pb = `${b.obdobieDo || ""}`;
    return pb.localeCompare(pa);
  });

  // 4. Parse financial statements (max 5 years)
  const statements: any[] = [];
  const maxYears = 5;
  const seenYears = new Set<number>();

  for (const z of zavierky) {
    if (statements.length >= maxYears) break;
    const period = `${z.obdobieOd || ""}-${z.obdobieDo || ""}`;
    const year = extractYear(z.obdobieDo || z.datumZostaveniaK || "");
    if (!year || seenYears.has(year)) continue;
    seenYears.add(year);

    const vykazIds: number[] = z.idUctovnychVykazov || [];
    const allTables: any[] = [];

    for (const vid of vykazIds) {
      const vykaz = await ruzGet("uctovny-vykaz", { id: vid });
      if (vykaz?.obsah?.tabulky) {
        allTables.push(...vykaz.obsah.tabulky);
      }
    }

    if (allTables.length === 0) continue;

    // Identify and reorder tables
    const tabMap = identifyTables(allTables);
    if (tabMap.aktiv === undefined || tabMap.pasiv === undefined) continue;

    const ordered: any[] = [];
    ordered.push(allTables[tabMap.aktiv]);
    ordered.push(allTables[tabMap.pasiv]);
    if (tabMap.income !== undefined) ordered.push(allTables[tabMap.income]);

    const hasIncome = ordered.length > 2;

    // Extract metrics
    const celkoveAktiva = getActivValue(ordered, ROW_TOTAL_ASSETS);
    const obeznyMajetok = getActivValue(ordered, ROW_CURRENT_ASSETS);
    const zasoby = getActivValue(ordered, ROW_INVENTORY);
    const peniaze = getActivValue(ordered, ROW_CASH);
    const pohladavky = getActivValue(ordered, ROW_TRADE_RECEIVABLES);

    const vlastneImanie = getPasivValue(ordered, ROW_TOTAL_EQUITY);
    const dlhodobeZavazky = getPasivValue(ordered, ROW_LT_LIABILITIES);
    const kratkodobeZavazky = getPasivValue(ordered, ROW_ST_LIABILITIES);
    const zavazkyObchod = getPasivValue(ordered, ROW_TRADE_PAYABLES);
    const zavazkySP = getPasivValue(ordered, ROW_SOCIAL_INS_LIAB);
    const danoveZavazky = getPasivValue(ordered, ROW_TAX_LIAB);
    const zavazkyZamestnanci = getPasivValue(ordered, ROW_EMPLOYEE_LIAB);

    const trzby = hasIncome ? getIncomeValue(ordered, ROW_NET_REVENUE) : null;
    const osobneNaklady = hasIncome ? getIncomeValue(ordered, ROW_PERSONNEL_COSTS) : null;
    const odpisy = hasIncome ? getIncomeValue(ordered, ROW_DEPRECIATION) : null;
    const uroky = hasIncome ? getIncomeValue(ordered, ROW_INTEREST_EXPENSE) : null;
    const ziskPoZdaneni = hasIncome ? getIncomeValue(ordered, ROW_NET_PROFIT) : null;

    let hrubaMarza: number | null = null;
    if (hasIncome) {
      const cogs = getIncomeValue(ordered, ROW_COGS);
      if (trzby !== null && cogs !== null) hrubaMarza = trzby - cogs;
      if (hrubaMarza === null) hrubaMarza = getIncomeValue(ordered, ROW_VALUE_ADDED);
    }

    // Estimate OCF
    let estimatedOCF: number | null = null;
    if (ziskPoZdaneni !== null && odpisy !== null) {
      const zasobyPrev = getActivValue(ordered, ROW_INVENTORY, false);
      const pohladavkyPrev = getActivValue(ordered, ROW_TRADE_RECEIVABLES, false);
      const zavazkyObchodPrev = getPasivValue(ordered, ROW_TRADE_PAYABLES, false);
      estimatedOCF = ziskPoZdaneni + odpisy;
      if (zasoby !== null && zasobyPrev !== null) estimatedOCF -= zasoby - zasobyPrev;
      if (pohladavky !== null && pohladavkyPrev !== null) estimatedOCF -= pohladavky - pohladavkyPrev;
      if (zavazkyObchod !== null && zavazkyObchodPrev !== null) estimatedOCF += zavazkyObchod - zavazkyObchodPrev;
      estimatedOCF = Math.round(estimatedOCF * 100) / 100;
    }

    // Employee count from titulnaStrana
    const titulna = allTables[0]?.nazov ? null : null; // Not directly available here

    statements.push({
      year,
      totalAssets: celkoveAktiva,
      currentAssets: obeznyMajetok,
      equity: vlastneImanie,
      shortTermLiabilities: kratkodobeZavazky,
      longTermLiabilities: dlhodobeZavazky,
      mainActivityRevenue: trzby,
      grossProfit: hrubaMarza,
      netProfitLoss: ziskPoZdaneni,
      cashAndEquivalents: peniaze,
      operatingCashFlow: estimatedOCF,
      staffCosts: osobneNaklady,
      tradeReceivables: pohladavky,
      tradePayables: zavazkyObchod,
      inventory: zasoby,
      depreciation: odpisy,
      interestExpense: uroky,
      socialInsuranceLiabilities: zavazkySP,
      taxLiabilities: danoveZavazky,
      employeeLiabilities: zavazkyZamestnanci,
      statementType: "SK_GAAP",
      monthsInPeriod: 12,
      isConsolidated: false,
    });
  }

  // 5. Get NACE text from skNace code
  const naceCode = entity.skNace || null;
  const naceTextMap: Record<string, string> = {
    "49410": "Cestná doprava osobná",
    "49390": "Ostatná pozemná doprava",
    "49420": "Cestná doprava nákladná",
  };
  const naceText = naceTextMap[naceCode || ""] || null;

  // 6. Parse legal form
  const legalFormMap: Record<string, string> = {
    "112": "s.r.o.",
    "121": "a.s.",
    "113": "v.o.s.",
    "114": "k.s.",
    "101": "fyzická osoba",
    "107": "živnostník",
  };
  const legalForm = legalFormMap[entity.pravnaForma || ""] || entity.pravnaForma || null;

  // 7. Parse datum zalozenia
  let establishedAt: Date | null = null;
  if (entity.datumZalozenia) {
    establishedAt = new Date(entity.datumZalozenia);
  }

  // 8. Upsert Company
  const company = await prisma.company.upsert({
    where: { ico },
    create: {
      ico,
      name: entity.nazovUJ || null,
      legalForm,
      city: entity.mesto || null,
      street: entity.ulica || null,
      zipCode: entity.psc || null,
      country: "Slovensko",
      establishedAt,
      status: "active",
      naceCode: naceCode,
      naceText: naceText,
    },
    update: {
      name: entity.nazovUJ || null,
      legalForm,
      city: entity.mesto || null,
      street: entity.ulica || null,
      zipCode: entity.psc || null,
      country: "Slovensko",
      establishedAt,
      status: "active",
      naceCode: naceCode,
      naceText: naceText,
    },
  });

  // 9. Upsert FinancialStatements
  let upsertedStmts = 0;
  for (const stmt of statements) {
    await prisma.financialStatement.upsert({
      where: {
        companyIco_year: { companyIco: ico, year: stmt.year },
      },
      create: {
        companyIco: ico,
        year: stmt.year,
        totalAssets: stmt.totalAssets,
        currentAssets: stmt.currentAssets,
        equity: stmt.equity,
        shortTermLiabilities: stmt.shortTermLiabilities,
        longTermLiabilities: stmt.longTermLiabilities,
        mainActivityRevenue: stmt.mainActivityRevenue,
        grossProfit: stmt.grossProfit,
        netProfitLoss: stmt.netProfitLoss,
        cashAndEquivalents: stmt.cashAndEquivalents,
        operatingCashFlow: stmt.operatingCashFlow,
        staffCosts: stmt.staffCosts,
        tradeReceivables: stmt.tradeReceivables,
        tradePayables: stmt.tradePayables,
        inventory: stmt.inventory,
        depreciation: stmt.depreciation,
        interestExpense: stmt.interestExpense,
        socialInsuranceLiabilities: stmt.socialInsuranceLiabilities,
        taxLiabilities: stmt.taxLiabilities,
        employeeLiabilities: stmt.employeeLiabilities,
        statementType: stmt.statementType,
        monthsInPeriod: stmt.monthsInPeriod,
        isConsolidated: stmt.isConsolidated,
      },
      update: {
        totalAssets: stmt.totalAssets,
        currentAssets: stmt.currentAssets,
        equity: stmt.equity,
        shortTermLiabilities: stmt.shortTermLiabilities,
        longTermLiabilities: stmt.longTermLiabilities,
        mainActivityRevenue: stmt.mainActivityRevenue,
        grossProfit: stmt.grossProfit,
        netProfitLoss: stmt.netProfitLoss,
        cashAndEquivalents: stmt.cashAndEquivalents,
        operatingCashFlow: stmt.operatingCashFlow,
        staffCosts: stmt.staffCosts,
        tradeReceivables: stmt.tradeReceivables,
        tradePayables: stmt.tradePayables,
        inventory: stmt.inventory,
        depreciation: stmt.depreciation,
        interestExpense: stmt.interestExpense,
        socialInsuranceLiabilities: stmt.socialInsuranceLiabilities,
        taxLiabilities: stmt.taxLiabilities,
        employeeLiabilities: stmt.employeeLiabilities,
      },
    });
    upsertedStmts++;
  }

  return {
    success: true,
    company: { name: company.name, ico: company.ico, city: company.city, legalForm: company.legalForm },
    statements: upsertedStmts,
    years: statements.map((s) => s.year),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ico: string }> }
) {
  const [, error] = await requireAdmin(req);
  if (error) return error;

  const { ico } = await params;
  if (!/^\d{8,10}$/.test(ico)) {
    return NextResponse.json({ error: "Invalid IČO format" }, { status: 400 });
  }

  try {
    const result = await seedCompany(ico);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
