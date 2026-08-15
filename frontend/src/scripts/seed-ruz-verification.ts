#!/usr/bin/env npx tsx
/**
 * Phase 2: RÚZ Verification
 *
 * For each company in our DB (s.r.o. + a.s.), queries the RÚZ API to:
 * 1. Check if the company has been active in 2025 (uctovne-jednotky?ico=XXX&zmenene-od=2025-01-01)
 * 2. Get entity details (velkostOrganizacie, skNace, druhVlastnictva, ruzEntityId)
 * 3. Check for 2025 financial statements (uctovne-zavierky?ico=XXX&zmenene-od=2025-06-01)
 *
 * Updates Company table with: ruzEntityId, sizeCategory, naceCode, naceText, ownershipType, ruzSyncedAt
 * Companies with 2025 statements get status='ruz_verified'.
 *
 * Usage:
 *   npx tsx src/scripts/seed-ruz-verification.ts                    # full run
 *   npx tsx src/scripts/seed-ruz-verification.ts --resume           # resume from checkpoint
 *   npx tsx src/scripts/seed-ruz-verification.ts --limit=100        # test on 100 companies
 *   npx tsx src/scripts/seed-ruz-verification.ts --concurrency=20   # set concurrency
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";
const CHECKPOINT_FILE = "seed-ruz-checkpoint.json";
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_LIMIT = 0; // 0 = no limit
const ZMENENE_OD = "2025-01-01";
const ZMENENE_OD_ZAVIERKY = "2026-01-01"; // závierky za fiškálny rok 2025 sa podávajú v 2026

// Size category mapping (RÚZ codes → employee count ranges)
const SIZE_MAP: Record<string, string> = {
  "00": "nezistený",
  "01": "0 zamestnancov",
  "02": "1 zamestnanec",
  "03": "2 zamestnanci",
  "04": "3-4 zamestnanci",
  "05": "5-9 zamestnancov",
  "06": "10-19 zamestnancov",
  "07": "20-24 zamestnancov",
  "11": "25-49 zamestnancov",
  "12": "50-99 zamestnancov",
  "21": "100-149 zamestnancov",
  "22": "150-199 zamestnancov",
  "23": "200-249 zamestnancov",
  "24": "250-499 zamestnancov",
  "25": "500-999 zamestnancov",
  "31": "1000-1999 zamestnancov",
  "32": "2000-2999 zamestnancov",
  "33": "3000-3999 zamestnancov",
  "34": "4000-4999 zamestnancov",
  "35": "5000-9999 zamestnancov",
  "36": "10000-19999 zamestnancov",
  "37": "20000-29999 zamestnancov",
  "38": "30000+ zamestnancov",
};

// Employee count midpoint for sorting
const EMPLOYEE_COUNT_MAP: Record<string, number> = {
  "00": 0, "01": 0, "02": 1, "03": 2, "04": 3, "05": 7,
  "06": 15, "07": 22, "11": 37, "12": 75, "21": 125, "22": 175,
  "23": 225, "24": 375, "25": 750, "31": 1500, "32": 2500,
  "33": 3500, "34": 4500, "35": 7500, "36": 15000, "37": 25000, "38": 30000,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface RuzEntityIdResponse {
  id: number[];
  existujeDalsieId: boolean;
}

interface RuzEntityDetail {
  id: number;
  ico: string;
  nazovUJ: string;
  pravnaForma: string;
  velkostOrganizacie: string;
  skNace: string;
  druhVlastnictva: string;
  datumZalozenia: string;
  datumZrusenia?: string;
  datumPoslednejUpravy: string;
  idUctovnychZavierok?: number[];
}

interface RuzZavierkaListResponse {
  id: number[];
  existujeDalsieId: boolean;
}

interface RuzZavierkaDetail {
  id: number;
  obdobieOd: string;
  obdobieDo: string;
  typ: string;
  stav?: string;
  datumPodania: string;
  idUctovnychVykazov: number[];
}

interface Checkpoint {
  processedIcos: string[];
  verifiedCount: number;
  withStatementsCount: number;
  errorCount: number;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { processedIcos: [], verifiedCount: 0, withStatementsCount: 0, errorCount: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── HTTP with exponential backoff ────────────────────────────────────────────

const REQUEST_DELAY_MS = 300; // 300ms between requests per worker

async function fetchWithRetry(url: string, maxRetries = 8): Promise<any | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Rate limit: wait before each request
      if (attempt === 0) await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Verifa.sk/1.0 (RÚZ verification)",
          Accept: "application/json",
        },
      });

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
      lastError = e as Error;
      const wait = Math.min(1000 * Math.pow(2, attempt), 10000);
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  console.error(`    Failed after ${maxRetries} retries: ${url}`);
  throw lastError || new Error("Unknown error");
}

// ─── RÚZ API calls ────────────────────────────────────────────────────────────

async function getEntityIdByIco(ico: string): Promise<number | null> {
  const url = `${RUZ_BASE}/uctovne-jednotky?ico=${ico}&zmenene-od=${ZMENENE_OD}&max-zaznamov=1`;
  const data: RuzEntityIdResponse = await fetchWithRetry(url);
  if (!data || !data.id || data.id.length === 0) return null;
  return data.id[0];
}

async function getEntityDetail(entityId: number): Promise<RuzEntityDetail | null> {
  const url = `${RUZ_BASE}/uctovna-jednotka?id=${entityId}`;
  return await fetchWithRetry(url);
}

async function has2025Statement(detail: RuzEntityDetail): Promise<boolean> {
  const zavierkyIds = detail.idUctovnychZavierok || [];
  if (zavierkyIds.length === 0) return false;

  // Check last 3 závierky (most recent, since IDs are sequential)
  const toCheck = zavierkyIds.slice(-3);
  for (const zavierkaId of toCheck) {
    const zavierka: RuzZavierkaDetail = await fetchWithRetry(
      `${RUZ_BASE}/uctovna-zavierka?id=${zavierkaId}`
    );
    if (zavierka && zavierka.obdobieDo === "2025-12" && zavierka.stav !== "ZMAZANÉ") {
      return true;
    }
  }
  return false;
}

// ─── Process one company ──────────────────────────────────────────────────────

async function processCompany(ico: string): Promise<{ verified: boolean; has2025: boolean }> {
  // Step 1: Get RÚZ entity ID — only entities modified since 2026-01-01
  // (companies that filed 2025 statements will have been updated in 2026)
  const entityId = await getEntityIdByIco(ico);
  if (!entityId) return { verified: false, has2025: false };

  // Step 2: Get entity details
  const detail = await getEntityDetail(entityId);
  if (!detail) return { verified: false, has2025: false };

  // Step 3: Check if entity has 2025 statements via idUctovnychZavierok
  // Only check last 3 závierky to minimize API calls
  const has2025 = await has2025Statement(detail);

  // Step 4: Update DB
  await prisma.company.update({
    where: { ico },
    data: {
      ruzEntityId: detail.id,
      sizeCategory: SIZE_MAP[detail.velkostOrganizacie] || detail.velkostOrganizacie,
      employeeCount: EMPLOYEE_COUNT_MAP[detail.velkostOrganizacie] ?? 0,
      naceCode: detail.skNace || undefined,
      ownershipType: detail.druhVlastnictva || undefined,
      ruzSyncedAt: new Date(),
      status: has2025 ? "ruz_verified" : "ruz_checked",
    },
  });

  return { verified: true, has2025 };
}

// ─── Batch processor with concurrency ─────────────────────────────────────────

async function processBatch(
  icos: string[],
  concurrency: number,
  cp: Checkpoint,
  offset: number
): Promise<void> {
  let active = 0;
  let idx = 0;
  let batchVerified = 0;
  let batch2025 = 0;
  let batchErrors = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      while (active < concurrency && idx < icos.length) {
        const ico = icos[idx++];
        active++;

        processCompany(ico)
          .then(({ verified, has2025 }) => {
            if (verified) {
              batchVerified++;
              cp.verifiedCount++;
              if (has2025) {
                batch2025++;
                cp.withStatementsCount++;
              }
            }
            cp.processedIcos.push(ico);
          })
          .catch((e) => {
            batchErrors++;
            cp.errorCount++;
            cp.processedIcos.push(ico);
            if (batchErrors % 10 === 0) {
              console.error(`    Error on ${ico}: ${e?.message || e}`);
            }
          })
          .finally(() => {
            active--;
            const total = offset + idx;
            if (total % 500 === 0) {
              console.log(
                `  [${total}] Verified: ${batchVerified}, 2025: ${batch2025}, Errors: ${batchErrors}`
              );
              saveCheckpoint(cp);
            }
            if (idx < icos.length) {
              next();
            } else if (active === 0) {
              console.log(
                `  Batch done: Verified: ${batchVerified}, 2025: ${batch2025}, Errors: ${batchErrors}`
              );
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
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : DEFAULT_LIMIT;
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg ? parseInt(concArg.split("=")[1]) : DEFAULT_CONCURRENCY;

  const cp = resume ? loadCheckpoint() : { processedIcos: [], verifiedCount: 0, withStatementsCount: 0, errorCount: 0 };

  // Get all s.r.o. + a.s. IČOs from DB
  const companies = await prisma.company.findMany({
    where: { legalForm: { in: ["s.r.o.", "a.s."] } },
    select: { ico: true },
    orderBy: { ico: "asc" },
  });

  const processedSet = new Set(cp.processedIcos);
  let icos = companies.map((c) => c.ico).filter((ico) => !processedSet.has(ico));

  if (limit > 0) icos = icos.slice(0, limit);

  console.log(`RÚZ Verification`);
  console.log(`  Total s.r.o.+a.s. in DB: ${companies.length}`);
  console.log(`  Already processed: ${cp.processedIcos.length}`);
  console.log(`  To process: ${icos.length}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Checkpoint: verified=${cp.verifiedCount}, 2025=${cp.withStatementsCount}, errors=${cp.errorCount}`);
  console.log();

  const startTime = Date.now();
  const BATCH_SIZE = 5000;

  for (let i = 0; i < icos.length; i += BATCH_SIZE) {
    const batch = icos.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(icos.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches} (${i + 1}-${i + batch.length})`);

    await processBatch(batch, concurrency, cp, i + cp.processedIcos.length);
    saveCheckpoint(cp);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("RÚZ VERIFICATION REPORT");
  console.log("=".repeat(60));
  console.log(`  Total processed:      ${cp.processedIcos.length}`);
  console.log(`  Verified in RÚZ:      ${cp.verifiedCount}`);
  console.log(`  With 2025 statements: ${cp.withStatementsCount}`);
  console.log(`  Errors:               ${cp.errorCount}`);
  console.log(`  Elapsed:              ${elapsed}s`);
  console.log("=".repeat(60));

  // Count by size category
  const bySize = await prisma.company.groupBy({
    by: ["sizeCategory"],
    where: { ruzSyncedAt: { not: null } },
    _count: true,
  });
  console.log("\nBy size category:");
  bySize.forEach((s) => console.log(`  ${s.sizeCategory}: ${s._count.sizeCategory}`));

  const verified = await prisma.company.count({ where: { status: "ruz_verified" } });
  console.log(`\nCompanies with 2025 statements (ruz_verified): ${verified}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
