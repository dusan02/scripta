#!/usr/bin/env npx tsx
/**
 * Bulk financial statement denormalization.
 *
 * For each ruz_active company in DB:
 * 1. Fetch entity detail by ruzEntityId (already stored) → get idUctovnychZavierok
 * 2. Fetch latest závierka → get idUctovnychVykazov
 * 3. Fetch first výkaz → parse tables for revenue, profit, assets, equity
 * 4. Upsert FinancialStatement + update Company denormalized fields
 *
 * ~3 API calls per company (entity + závierka + výkaz) instead of 10+.
 * With concurrency=10 and 200ms delay: ~80 companies/min → 404K in ~84 hours.
 * With concurrency=20: ~160 companies/min → ~42 hours.
 *
 * Usage:
 *   npx tsx src/scripts/seed-financials-bulk.ts --max=100          # test
 *   npx tsx src/scripts/seed-financials-bulk.ts --concurrency=10   # production
 *   npx tsx src/scripts/seed-financials-bulk.ts --resume           # resume from checkpoint
 *   npx tsx src/scripts/seed-financials-bulk.ts --years=3          # fetch last 3 years (default 1)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const CHECKPOINT_FILE = "seed-financials-bulk-checkpoint.json";
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_MAX = 0;
const DEFAULT_YEARS = 1;
const REQUEST_DELAY_MS = 200;
const BATCH_SIZE = 5000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Checkpoint {
  processedIcos: string[];
  totalStmts: number;
  totalCompanies: number;
  failedCount: number;
  apiErrors: number;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { processedIcos: [], totalStmts: 0, totalCompanies: 0, failedCount: 0, apiErrors: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── HTTP with exponential backoff ────────────────────────────────────────────

async function fetchWithRetry(url: string, maxRetries = 5): Promise<any | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt === 0) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });

      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 60000);
        if (attempt < 2) console.log(`    ${res.status} — backing off ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const text = await res.text();
      if (!text || text.trim() === "") return null;
      return JSON.parse(text);
    } catch (e) {
      if (attempt < maxRetries - 1) {
        const wait = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        console.log(`    FETCH FAIL: ${url} — ${e}`);
        return null;
      }
    }
  }
  return null;
}

// ─── RÚZ table parsing ────────────────────────────────────────────────────────

function toFloat(val: unknown): number | null {
  if (val === null || val === "" || val === " ") return null;
  if (typeof val === "boolean") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[\s\xa0]/g, "");
    if (!cleaned) return null;
    let isNeg = false;
    let s = cleaned;
    if (s.startsWith("(") && s.endsWith(")")) { isNeg = true; s = s.slice(1, -1); }
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

// ─── Process one company ──────────────────────────────────────────────────────

async function processCompany(
  ico: string,
  ruzEntityId: number,
  maxYears: number
): Promise<{ stmts: number; latestYear: number | null; latestRevenue: number | null; latestProfit: number | null; latestAssets: number | null; latestEquity: number | null }> {
  // 1. Fetch entity detail to get závierka IDs
  const entity = await fetchWithRetry(`${RUZ_BASE}/uctovna-jednotka?id=${ruzEntityId}`);
  if (!entity || !entity.idUctovnychZavierok?.length) {
    return { stmts: 0, latestYear: null, latestRevenue: null, latestProfit: null, latestAssets: null, latestEquity: null };
  }

  // 2. Fetch ALL závierky (array is NOT chronologically ordered — must fetch all and sort)
  const zavierkaIds: number[] = entity.idUctovnychZavierok;
  const allZavierky: any[] = [];

  // Quick IFRS check: fetch first závierka, check first výkaz pristupnostDat
  // If "Verejné prílohy" → IFRS/PDF-only, skip entire company to save API calls
  if (zavierkaIds.length > 0) {
    const firstZ = await fetchWithRetry(`${RUZ_BASE}/uctovna-zavierka?id=${zavierkaIds[0]}`);
    if (firstZ && firstZ.idUctovnychVykazov?.length > 0) {
      const firstV = await fetchWithRetry(`${RUZ_BASE}/uctovny-vykaz?id=${firstZ.idUctovnychVykazov[0]}`);
      if (firstV?.pristupnostDat === "Verejné prílohy") {
        // Check a second výkaz to be sure (some závierky have mixed)
        const hasJson = firstZ.idUctovnychVykazov.some((_: any, i: number) => i > 0);
        if (hasJson) {
          let foundJson = false;
          for (let i = 1; i < firstZ.idUctovnychVykazov.length && !foundJson; i++) {
            const v = await fetchWithRetry(`${RUZ_BASE}/uctovny-vykaz?id=${firstZ.idUctovnychVykazov[i]}`);
            if (v?.obsah?.tabulky?.length > 0) foundJson = true;
          }
          if (!foundJson) {
            // All výkazy in first závierka are PDF-only → likely IFRS, skip
            return { stmts: 0, latestYear: null, latestRevenue: null, latestProfit: null, latestAssets: null, latestEquity: null };
          }
        } else {
          return { stmts: 0, latestYear: null, latestRevenue: null, latestProfit: null, latestAssets: null, latestEquity: null };
        }
      }
    }
    if (firstZ && firstZ.obdobieDo && firstZ.stav !== "ZMAZANÉ") allZavierky.push(firstZ);
  }

  // Fetch remaining závierky
  for (let i = 1; i < zavierkaIds.length; i++) {
    const z = await fetchWithRetry(`${RUZ_BASE}/uctovna-zavierka?id=${zavierkaIds[i]}`);
    if (z && z.obdobieDo && z.stav !== "ZMAZANÉ") {
      allZavierky.push(z);
    }
  }

  if (!allZavierky.length) {
    return { stmts: 0, latestYear: null, latestRevenue: null, latestProfit: null, latestAssets: null, latestEquity: null };
  }

  // Sort by obdobieDo desc — most recent first
  allZavierky.sort((a, b) => (b.obdobieDo || "").localeCompare(a.obdobieDo || ""));

  // Deduplicate by year, take first maxYears
  const seenYears = new Set<number>();
  const stmts: any[] = [];

  for (const z of allZavierky) {
    if (stmts.length >= maxYears) break;
    const yearMatch = (z.obdobieDo || "").match(/20\d{2}/);
    if (!yearMatch) continue;
    const year = parseInt(yearMatch[0]);
    if (seenYears.has(year)) continue;
    seenYears.add(year);

    // 3. Fetch výkazy — try each until we find one with populated tabulky
    const vykazIds = z.idUctovnychVykazov || [];
    if (!vykazIds.length) continue;

    let tables: any[] | null = null;
    for (const vid of vykazIds) {
      const v = await fetchWithRetry(`${RUZ_BASE}/uctovny-vykaz?id=${vid}`);
      if (v?.obsah?.tabulky?.length > 0) {
        tables = v.obsah.tabulky;
        break;
      }
    }
    if (!tables) continue;

    const tm = identifyTables(tables);
    if (tm.aktiv === undefined || tm.pasiv === undefined) continue;

    const ordered = [tables[tm.aktiv], tables[tm.pasiv]];
    if (tm.income !== undefined) ordered.push(tables[tm.income]);
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
      profitBeforeTax: hasIncome ? incomeVal(ordered, 56) : null,
      operatingCosts: cogs,
      socialInsuranceLiabilities: pasivVal(ordered, 132),
      taxLiabilities: pasivVal(ordered, 133),
      employeeLiabilities: pasivVal(ordered, 131),
      statementType: "SK_GAAP",
      monthsInPeriod: 12,
      isConsolidated: false,
    });
  }

  if (!stmts.length) {
    return { stmts: 0, latestYear: null, latestRevenue: null, latestProfit: null, latestAssets: null, latestEquity: null };
  }

  // 4. Upsert financial statements
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
        profitBeforeTax: s.profitBeforeTax,
        operatingCosts: s.operatingCosts,
        socialInsuranceLiabilities: s.socialInsuranceLiabilities,
        taxLiabilities: s.taxLiabilities,
        employeeLiabilities: s.employeeLiabilities,
      },
    });
  }

  // 5. Update Company denormalized fields
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

  return {
    stmts: stmts.length,
    latestYear: latest.year,
    latestRevenue: latest.mainActivityRevenue,
    latestProfit: latest.netProfitLoss,
    latestAssets: latest.totalAssets,
    latestEquity: latest.equity,
  };
}

// ─── Batch processor ──────────────────────────────────────────────────────────

async function processBatch(
  companies: { ico: string; ruzEntityId: number; name: string | null }[],
  concurrency: number,
  maxYears: number,
  cp: Checkpoint
): Promise<void> {
  let active = 0;
  let idx = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      while (active < concurrency && idx < companies.length) {
        const c = companies[idx++];
        active++;

        processCompany(c.ico, c.ruzEntityId, maxYears)
          .then((result) => {
            if (result.stmts > 0) {
              cp.totalStmts += result.stmts;
              cp.totalCompanies++;
            } else {
              cp.failedCount++;
            }
            cp.processedIcos.push(c.ico);
          })
          .catch((e) => {
            cp.failedCount++;
            cp.apiErrors++;
            cp.processedIcos.push(c.ico);
            if (cp.apiErrors % 10 === 0) {
              console.error(`    Error on ${c.ico}: ${e?.message || e}`);
            }
          })
          .finally(() => {
            active--;
            const total = cp.processedIcos.length;
            if (total % 500 === 0) {
              const pct = ((cp.totalCompanies / total) * 100).toFixed(1);
              console.log(
                `  [${total}] With stmts: ${cp.totalCompanies}, Failed: ${cp.failedCount}, Errors: ${cp.apiErrors} (${pct}% success)`
              );
              saveCheckpoint(cp);
            }
            if (idx < companies.length) {
              next();
            } else if (active === 0) {
              resolve();
            }
          });
      }
    };
    next();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const max = maxArg ? parseInt(maxArg.split("=")[1]) : DEFAULT_MAX;
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg ? parseInt(concArg.split("=")[1]) : DEFAULT_CONCURRENCY;
  const yearsArg = args.find((a) => a.startsWith("--years="));
  const maxYears = yearsArg ? parseInt(yearsArg.split("=")[1]) : DEFAULT_YEARS;

  let cp = loadCheckpoint();
  if (!resume) {
    cp = { processedIcos: [], totalStmts: 0, totalCompanies: 0, failedCount: 0, apiErrors: 0 };
  }

  const processedSet = new Set(cp.processedIcos);

  console.log("Financial Statements — Bulk Denormalization");
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Years per company: ${maxYears}`);
  console.log(`  Checkpoint: processed=${cp.processedIcos.length}, stmts=${cp.totalStmts}, companies=${cp.totalCompanies}`);
  console.log();

  const startTime = Date.now();

  // Process companies in DB batches — no loading all into memory
  console.log("Fetching companies from DB (streaming batches)...");

  const DB_BATCH = 5000;
  let cursor: string | null = null;
  let totalProcessed = 0;
  let totalStmts = 0;
  let totalOk = 0;
  let totalFailed = 0;
  let totalApiErrors = 0;
  let batchNum = 0;

  while (true) {
    const batch: any[] = await prisma.company.findMany({
      where: {
        status: "ruz_active",
        ruzEntityId: { not: null },
        latestYear: null,
        ...(cursor ? { ico: { gt: cursor } } : {}),
      },
      select: { ico: true, ruzEntityId: true, name: true, employeeCount: true },
      orderBy: [{ ico: "asc" }],
      take: DB_BATCH,
    });
    if (!batch.length) break;
    cursor = batch[batch.length - 1].ico;

    const companies = batch
      .filter((c) => !processedSet.has(c.ico) && c.ruzEntityId !== null)
      .map((c) => ({ ico: c.ico, ruzEntityId: c.ruzEntityId!, name: c.name }));

    batchNum++;
    console.log(`\nBatch ${batchNum} (${totalProcessed + 1}-${totalProcessed + companies.length})`);

    if (!companies.length) {
      totalProcessed += batch.length;
      continue;
    }

    // Process with concurrency
    let idx = 0;
    const results: { stmts: number }[] = [];

    async function worker() {
      while (idx < companies.length) {
        const i = idx++;
        const company = companies[i];
        const result = await processCompany(company.ico, company.ruzEntityId, maxYears);
        results.push(result);

        if (result.stmts > 0) totalOk++;
        else totalFailed++;
        totalStmts += result.stmts;
        // totalApiErrors tracked via fetchWithRetry internally
        totalProcessed++;
        cp.totalStmts = totalStmts;
        cp.totalCompanies = totalOk;
        cp.failedCount = totalFailed;
        cp.apiErrors = totalApiErrors;
        cp.processedIcos.push(company.ico);

        if (totalProcessed % 500 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = totalProcessed / elapsed;
          console.log(
            `  [${totalProcessed}] With stmts: ${totalOk}, Failed: ${totalFailed}, Errors: ${totalApiErrors} ` +
              `(${rate.toFixed(1)}/s)`
          );
          saveCheckpoint(cp);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    saveCheckpoint(cp);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const rate = (cp.processedIcos.length / (parseFloat(elapsed) || 1)).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("FINANCIAL DENORMALIZATION REPORT");
  console.log("=".repeat(60));
  console.log(`  Total processed:       ${cp.processedIcos.length}`);
  console.log(`  Companies with stmts:  ${cp.totalCompanies}`);
  console.log(`  Companies failed:      ${cp.failedCount}`);
  console.log(`  Statements fetched:    ${cp.totalStmts}`);
  console.log(`  API errors:            ${cp.apiErrors}`);
  console.log(`  Elapsed:               ${elapsed}s (${rate} companies/s)`);
  console.log("=".repeat(60));

  // Verify denormalized fields in DB
  const withLatestYear = await prisma.company.count({ where: { latestYear: { not: null } } });
  const totalActive = await prisma.company.count({ where: { status: "ruz_active" } });
  console.log(`\nDB: latestYear filled=${withLatestYear}, ruz_active=${totalActive} (${((withLatestYear / totalActive) * 100).toFixed(1)}%)`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
