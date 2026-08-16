#!/usr/bin/env npx tsx
/**
 * Seed financial statements for companies already in DB.
 *
 * Usage:
 *   npx tsx src/scripts/seed-financials.ts --max 100
 *   npx tsx src/scripts/seed-financials.ts --max 10000
 *   npx tsx src/scripts/seed-financials.ts --ico 31711651,35815256
 *
 * Priority: companies with most employees first (higher SEO value).
 * Idempotent: skips companies that already have financial statements.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

async function ruzGet(endpoint: string, params: Record<string, string | number>, retries = 2): Promise<any | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url.toString(), { headers: { "User-Agent": UA } });
      if (resp.ok) return await resp.json();
      if (resp.status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ── RÚZ table parsing (same logic as ruz.ts seedFromRuz) ───────────────────

function toFloat(val: unknown): number | null {
  if (val === null || val === "" || val === " ") return null;
  if (typeof val === "boolean") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[\s\xa0]/g, "");
    if (!cleaned) return null;
    let isNeg = false;
    let s = cleaned;
    if (s.startsWith("(") && s.endsWith(")")) {
      isNeg = true;
      s = s.slice(1, -1);
    }
    if (s.includes(",") && s.includes(".")) {
      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");
      if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",")) {
      s = s.replace(",", ".");
    }
    const n = parseFloat(s);
    if (isNaN(n)) return null;
    return isNeg ? -n : n;
  }
  return null;
}

function extractRow(row: unknown[], dataCols: number, targetCol: number): number | null {
  if (!Array.isArray(row)) return null;
  const dataStart = row.length === dataCols ? 0 : row.length > dataCols ? row.length - dataCols : -1;
  if (dataStart < 0) return null;
  const idx = dataStart + targetCol;
  if (idx < 0 || idx >= row.length) return null;
  return toFloat(row[idx]);
}

function getRow(tables: any[], tableIdx: number, cisloRiadku: number, offset: number, dataCols = 0): unknown[] | null {
  if (tableIdx >= tables.length) return null;
  const data = tables[tableIdx]?.data;
  if (!data || !Array.isArray(data)) return null;
  const idx = cisloRiadku - offset;
  if (idx < 0 || idx >= data.length) return null;
  const first = data[0];
  if (!Array.isArray(first) && dataCols > 0) {
    const start = idx * dataCols;
    if (start + dataCols > data.length) return null;
    return data.slice(start, start + dataCols);
  }
  return Array.isArray(data[idx]) ? data[idx] : null;
}

function activVal(tables: any[], cislo: number, current = true): number | null {
  const row = getRow(tables, 0, cislo, 1, 4);
  return row ? extractRow(row, 4, current ? 2 : 3) : null;
}

function pasivVal(tables: any[], cislo: number, current = true): number | null {
  const row = getRow(tables, 1, cislo, 79, 2);
  return row ? extractRow(row, 2, current ? 0 : 1) : null;
}

function incomeVal(tables: any[], cislo: number, current = true): number | null {
  const row = getRow(tables, 2, cislo, 1, 2);
  return row ? extractRow(row, 2, current ? 0 : 1) : null;
}

function identifyTables(tables: any[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    const nazov = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (nazov.includes("strana akt") || nazov.includes("aktív") || (nazov.includes("akt") && !nazov.includes("pas")))
      result.aktiv = i;
    else if (nazov.includes("strana pas") || nazov.includes("pasív") || nazov.includes("pas"))
      result.pasiv = i;
    else if (nazov.includes("ziskov a str") || nazov.includes("profit and loss") || nazov.includes("výsledovka"))
      result.income = i;
  }
  return result;
}

// ── Financial statement download ────────────────────────────────────────────

async function downloadFinancials(ico: string): Promise<number> {
  // Get entity IDs from RÚZ
  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico, "max-zaznamov": 10 });
  if (!eids?.id?.length) return 0;

  const entity = await ruzGet("uctovna-jednotka", { id: eids.id[0] });
  if (!entity) return 0;

  const zavierkaIds: number[] = entity.idUctovnychZavierok || [];
  if (!zavierkaIds.length) return 0;

  // Fetch all závierky
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
    const yearMatch = (z.obdobieDo || "").match(/20\d{2}/);
    if (!yearMatch) continue;
    const year = parseInt(yearMatch[0]);
    if (seenYears.has(year)) continue;
    seenYears.add(year);

    // Fetch all výkazy for this závierka
    const allTables: any[] = [];
    for (const vid of z.idUctovnychVykazov || []) {
      const v = await ruzGet("uctovny-vykaz", { id: vid });
      if (v?.obsah?.tabulky) allTables.push(...v.obsah.tabulky);
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
      year,
      totalAssets: activVal(ordered, 1),
      currentAssets: activVal(ordered, 33),
      equity: pasivVal(ordered, 80),
      shortTermLiabilities: pasivVal(ordered, 122),
      longTermLiabilities: pasivVal(ordered, 102),
      mainActivityRevenue: trzby,
      grossProfit: hrubaMarza,
      netProfitLoss: zisk,
      cashAndEquivalents: activVal(ordered, 72),
      operatingCashFlow: ocf,
      staffCosts: hasIncome ? incomeVal(ordered, 15) : null,
      tradeReceivables: pohladavky,
      tradePayables: zavazkyObchod,
      inventory: zasoby,
      depreciation: odpisy,
      interestExpense: hasIncome ? incomeVal(ordered, 49) : null,
      incomeTax: hasIncome ? incomeVal(ordered, 57) : null,
      socialInsuranceLiabilities: pasivVal(ordered, 132),
      taxLiabilities: pasivVal(ordered, 133),
      employeeLiabilities: pasivVal(ordered, 131),
      statementType: "SK_GAAP",
      monthsInPeriod: 12,
      isConsolidated: false,
    });
  }

  if (!stmts.length) return 0;

  // Upsert financial statements
  let count = 0;
  for (const s of stmts) {
    await prisma.financialStatement.upsert({
      where: { companyIco_year: { companyIco: ico, year: s.year } },
      create: { companyIco: ico, ...s },
      update: {
        totalAssets: s.totalAssets,
        currentAssets: s.currentAssets,
        equity: s.equity,
        shortTermLiabilities: s.shortTermLiabilities,
        longTermLiabilities: s.longTermLiabilities,
        mainActivityRevenue: s.mainActivityRevenue,
        grossProfit: s.grossProfit,
        netProfitLoss: s.netProfitLoss,
        cashAndEquivalents: s.cashAndEquivalents,
        operatingCashFlow: s.operatingCashFlow,
        staffCosts: s.staffCosts,
        tradeReceivables: s.tradeReceivables,
        tradePayables: s.tradePayables,
        inventory: s.inventory,
        depreciation: s.depreciation,
        interestExpense: s.interestExpense,
        incomeTax: s.incomeTax,
        socialInsuranceLiabilities: s.socialInsuranceLiabilities,
        taxLiabilities: s.taxLiabilities,
        employeeLiabilities: s.employeeLiabilities,
      },
    });
    count++;
  }

  // Update Company with latest year/revenue
  const latest = stmts[0];
  await prisma.company.update({
    where: { ico },
    data: {
      latestYear: latest.year,
      latestRevenue: latest.mainActivityRevenue,
      latestProfit: latest.netProfitLoss,
      latestAssets: latest.totalAssets,
      latestEquity: latest.equity,
    },
  });

  return count;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const maxArg = args.find((a) => a.startsWith("--max="));
  const icoArg = args.find((a) => a.startsWith("--ico="));
  const max = maxArg ? parseInt(maxArg.split("=")[1]) : 100;
  const icoList = icoArg ? icoArg.split("=")[1].split(",") : null;

  const where: any = { financialStatements: { none: {} } };
  if (icoList) where.ico = { in: icoList };

  const companies = await prisma.company.findMany({
    where,
    select: { ico: true, name: true, employeeCount: true },
    orderBy: [{ employeeCount: "desc" }, { ico: "asc" }],
    take: max,
  });

  console.log(`Found ${companies.length} companies without financials (sorted by employeeCount DESC)`);

  if (!companies.length) {
    console.log("Nothing to do — all companies already have financial statements.");
    return;
  }

  const startTime = Date.now();
  let totalStmts = 0;
  let totalCompanies = 0;
  let failed = 0;
  let apiErrors = 0;

  // Track per-company statement counts and years
  const stmtsPerCompany: number[] = [];
  const yearCounts: Record<number, number> = {};
  let revenueCoverage = 0;
  let profitCoverage = 0;
  let assetsCoverage = 0;
  let equityCoverage = 0;

  // Process with limited concurrency
  const CONCURRENCY = 5;
  for (let i = 0; i < companies.length; i += CONCURRENCY) {
    const batch = companies.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (c, j) => {
        const idx = i + j;
        try {
          const n = await downloadFinancials(c.ico);
          if (n > 0) {
            totalStmts += n;
            totalCompanies++;
            stmtsPerCompany.push(n);
            console.log(`[${idx + 1}/${companies.length}] ${c.name || c.ico}: ${n} statements`);
          } else {
            failed++;
            stmtsPerCompany.push(0);
            console.log(`[${idx + 1}/${companies.length}] ${c.name || c.ico}: no statements`);
          }
        } catch (e) {
          failed++;
          apiErrors++;
          stmtsPerCompany.push(0);
          console.error(`[${idx + 1}/${companies.length}] ${c.name || c.ico}: ERROR`, e);
        }
      })
    );
  }

  // Query DB for year distribution and coverage
  const stmts = await prisma.financialStatement.findMany({
    where: { companyIco: { in: companies.map((c) => c.ico) } },
    select: { year: true, mainActivityRevenue: true, netProfitLoss: true, totalAssets: true, equity: true, companyIco: true },
  });

  for (const s of stmts) {
    yearCounts[s.year] = (yearCounts[s.year] || 0) + 1;
    if (s.mainActivityRevenue !== null) revenueCoverage++;
    if (s.netProfitLoss !== null) profitCoverage++;
    if (s.totalAssets !== null) assetsCoverage++;
    if (s.equity !== null) equityCoverage++;
  }

  // Statements per company distribution
  const distBuckets: Record<string, number> = {};
  for (const n of stmtsPerCompany) {
    if (n === 0) distBuckets["0 (no statements)"] = (distBuckets["0 (no statements)"] || 0) + 1;
    else if (n === 1) distBuckets["1 year"] = (distBuckets["1 year"] || 0) + 1;
    else if (n === 2) distBuckets["2 years"] = (distBuckets["2 years"] || 0) + 1;
    else if (n === 3) distBuckets["3 years"] = (distBuckets["3 years"] || 0) + 1;
    else if (n === 4) distBuckets["4 years"] = (distBuckets["4 years"] || 0) + 1;
    else distBuckets["5+ years"] = (distBuckets["5+ years"] || 0) + 1;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (companies.length / (parseFloat(elapsed) || 1)).toFixed(1);

  // Final report
  console.log("\n" + "=".repeat(60));
  console.log("FINANCIAL SEED REPORT");
  console.log("=".repeat(60));
  console.log(`  Companies attempted:     ${companies.length}`);
  console.log(`  Companies with stmts:    ${totalCompanies}`);
  console.log(`  Companies without stmts: ${failed}`);
  console.log(`  Statements fetched:      ${totalStmts}`);
  console.log(`  Avg stmts/company:       ${(totalStmts / (totalCompanies || 1)).toFixed(1)}`);
  console.log(`  API errors:              ${apiErrors}`);
  console.log(`  Duplicate statements:    0 (upsert by companyIco_year)`);
  console.log(`  Elapsed:                 ${elapsed}s (${rate} companies/s)`);
  console.log(`  ETA for 10k:             ${Math.round(10000 / parseFloat(rate) / 60)} min`);

  console.log("\n── Statements per Company ──");
  for (const [bucket, count] of Object.entries(distBuckets).sort()) {
    console.log(`  ${bucket.padEnd(20)} ${count}`);
  }

  console.log("\n── Year Distribution ──");
  for (const [year, count] of Object.entries(yearCounts).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(`  ${year}: ${count}`);
  }

  console.log("\n── Field Coverage (non-null) ──");
  console.log(`  Revenue:  ${revenueCoverage}/${stmts.length} (${((revenueCoverage / (stmts.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  Profit:   ${profitCoverage}/${stmts.length} (${((profitCoverage / (stmts.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  Assets:   ${assetsCoverage}/${stmts.length} (${((assetsCoverage / (stmts.length || 1)) * 100).toFixed(1)}%)`);
  console.log(`  Equity:   ${equityCoverage}/${stmts.length} (${((equityCoverage / (stmts.length || 1)) * 100).toFixed(1)}%)`);
  console.log("=".repeat(60));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
