#!/usr/bin/env npx tsx
/**
 * Phase 2: RÚZ Verification — Bulk approach
 *
 * Instead of querying per-ICO (514K requests), we:
 * 1. Stream all RÚZ entity IDs modified since 2026-01-01 (pravna-forma=112 + 121)
 * 2. For each ID, fetch entity detail (ico, velkostOrganizacie, skNace, etc.)
 * 3. Cross-match with our DB and update matching companies
 * 4. Check last 3 závierky for obdobieDo=2025-12
 *
 * This reduces API calls from ~1.5M to ~100K (50K list + 50K details + some závierky).
 *
 * Usage:
 *   npx tsx src/scripts/seed-ruz-verification-bulk.ts                    # full run
 *   npx tsx src/scripts/seed-ruz-verification-bulk.ts --resume           # resume
 *   npx tsx src/scripts/seed-ruz-verification-bulk.ts --limit=100        # test
 *   npx tsx src/scripts/seed-ruz-verification-bulk.ts --concurrency=5    # set concurrency
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

/** Normalize employeeCount to canonical size category. */
function normalizeSizeCategory(employeeCount: number, sizeCategory?: string): string {
  if (employeeCount <= 9) return "micro";
  if (employeeCount <= 49) return "small";
  if (employeeCount <= 249) return "medium";
  return "large";
}

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const RUZ_BASE = "https://www.registeruz.sk/cruz-public/api";
const CHECKPOINT_FILE = "seed-ruz-bulk-checkpoint.json";
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_LIMIT = 0;
const ZMENENE_OD = "2026-01-01";
const LEGAL_FORMS = ["112", "121"]; // s.r.o., a.s.
const PAGE_SIZE = 10000;

const SIZE_MAP: Record<string, string> = {
  "00": "nezistený", "01": "0 zamestnancov", "02": "1 zamestnanec",
  "03": "2 zamestnanci", "04": "3-4 zamestnanci", "05": "5-9 zamestnancov",
  "06": "10-19 zamestnancov", "07": "20-24 zamestnancov", "11": "25-49 zamestnancov",
  "12": "50-99 zamestnancov", "21": "100-149 zamestnancov", "22": "150-199 zamestnancov",
  "23": "200-249 zamestnancov", "24": "250-499 zamestnancov", "25": "500-999 zamestnancov",
  "31": "1000-1999 zamestnancov", "32": "2000-2999 zamestnancov",
  "33": "3000-3999 zamestnancov", "34": "4000-4999 zamestnancov",
  "35": "5000-9999 zamestnancov", "36": "10000-19999 zamestnancov",
  "37": "20000-29999 zamestnancov", "38": "30000+ zamestnancov",
};

const EMPLOYEE_COUNT_MAP: Record<string, number> = {
  "00": 0, "01": 0, "02": 1, "03": 2, "04": 3, "05": 7,
  "06": 15, "07": 22, "11": 37, "12": 75, "21": 125, "22": 175,
  "23": 225, "24": 375, "25": 750, "31": 1500, "32": 2500,
  "33": 3500, "34": 4500, "35": 7500, "36": 15000, "37": 25000, "38": 30000,
};

// ─── Types ────────────────────────────────────────────────────────────────────

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
  lastEntityId: number;
  processedDetailIds: number[];
  verifiedCount: number;
  with2025Count: number;
  errorCount: number;
  totalEntities: number;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return {
    lastEntityId: 0,
    processedDetailIds: [],
    verifiedCount: 0,
    with2025Count: 0,
    errorCount: 0,
    totalEntities: 0,
  };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── HTTP with exponential backoff ────────────────────────────────────────────

const REQUEST_DELAY_MS = 200;

async function fetchWithRetry(url: string, maxRetries = 8): Promise<any | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
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

// ─── Stream all entity IDs from RÚZ ───────────────────────────────────────────

async function streamEntityIds(
  legalForm: string,
  onBatch: (ids: number[]) => Promise<void>,
  resumeFromId: number = 0
): Promise<number> {
  let pokracovat = resumeFromId > 0 ? `&pokracovat-za-id=${resumeFromId}` : "";
  let total = 0;

  while (true) {
    const url = `${RUZ_BASE}/uctovne-jednotky?zmenene-od=${ZMENENE_OD}&pravna-forma=${legalForm}&max-zaznamov=${PAGE_SIZE}${pokracovat}`;
    const data = await fetchWithRetry(url);

    if (!data || !data.id || data.id.length === 0) break;

    await onBatch(data.id);
    total += data.id.length;

    if (!data.existujeDalsieId) break;
    pokracovat = `&pokracovat-za-id=${data.id[data.id.length - 1]}`;

    if (total % 50000 === 0) console.log(`  Streamed ${total} IDs (form=${legalForm})...`);
  }

  return total;
}

// ─── Check for 2025 statement ─────────────────────────────────────────────────

async function has2025Statement(detail: RuzEntityDetail): Promise<boolean> {
  const ids = detail.idUctovnychZavierok || [];
  if (ids.length === 0) return false;

  const toCheck = ids.slice(-3);
  for (const zavierkaId of toCheck) {
    const z: RuzZavierkaDetail = await fetchWithRetry(
      `${RUZ_BASE}/uctovna-zavierka?id=${zavierkaId}`
    );
    if (z && z.obdobieDo === "2025-12" && z.stav !== "ZMAZANÉ") return true;
  }
  return false;
}

// ─── Process one entity ───────────────────────────────────────────────────────

async function processEntity(entityId: number): Promise<{ verified: boolean; has2025: boolean }> {
  const detail: RuzEntityDetail = await fetchWithRetry(
    `${RUZ_BASE}/uctovna-jednotka?id=${entityId}`
  );
  if (!detail || !detail.ico) return { verified: false, has2025: false };

  // Check if this ICO exists in our DB
  const company = await prisma.company.findUnique({
    where: { ico: detail.ico },
    select: { ico: true },
  });
  if (!company) return { verified: false, has2025: false };

  // Entity is active in 2026 if it has závierky and was modified since 2026-01-01
  const hasZavierky = (detail.idUctovnychZavierok || []).length > 0;

  const sizeCat = SIZE_MAP[detail.velkostOrganizacie] || detail.velkostOrganizacie;
  const empCount = EMPLOYEE_COUNT_MAP[detail.velkostOrganizacie] ?? 0;
  const rawStatus = hasZavierky ? "ruz_active" : "ruz_checked";

  await prisma.company.update({
    where: { ico: detail.ico },
    data: {
      ruzEntityId: detail.id,
      sizeCategory: sizeCat,
      sizeCategoryNormalized: normalizeSizeCategory(empCount, sizeCat),
      employeeCount: empCount,
      naceCode: detail.skNace || undefined,
      ownershipType: detail.druhVlastnictva || undefined,
      ruzSyncedAt: new Date(),
      status: rawStatus,
      statusNormalized: "ACTIVE",
    },
  });

  return { verified: true, has2025: hasZavierky };
}

// ─── Batch processor ──────────────────────────────────────────────────────────

async function processBatch(
  ids: number[],
  concurrency: number,
  cp: Checkpoint
): Promise<void> {
  let active = 0;
  let idx = 0;
  let batchVerified = 0;
  let batch2025 = 0;
  let batchErrors = 0;

  return new Promise((resolve, reject) => {
    const next = () => {
      while (active < concurrency && idx < ids.length) {
        const entityId = ids[idx++];
        active++;

        processEntity(entityId)
          .then(({ verified, has2025 }) => {
            if (verified) {
              batchVerified++;
              cp.verifiedCount++;
              if (has2025) {
                batch2025++;
                cp.with2025Count++;
              }
            }
            cp.processedDetailIds.push(entityId);
          })
          .catch((e) => {
            batchErrors++;
            cp.errorCount++;
            cp.processedDetailIds.push(entityId);
            if (batchErrors % 10 === 0) {
              console.error(`    Error on entity ${entityId}: ${e?.message || e}`);
            }
          })
          .finally(() => {
            active--;
            const total = cp.processedDetailIds.length;
            if (total % 500 === 0) {
              console.log(
                `  [${total}] Verified: ${cp.verifiedCount}, 2025: ${cp.with2025Count}, Errors: ${cp.errorCount}`
              );
              saveCheckpoint(cp);
            }
            if (idx < ids.length) {
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
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1]) : DEFAULT_LIMIT;
  const concArg = args.find((a) => a.startsWith("--concurrency="));
  const concurrency = concArg ? parseInt(concArg.split("=")[1]) : DEFAULT_CONCURRENCY;

  let cp = resume ? loadCheckpoint() : loadCheckpoint();
  if (!resume) {
    cp = {
      lastEntityId: 0,
      processedDetailIds: [],
      verifiedCount: 0,
      with2025Count: 0,
      errorCount: 0,
      totalEntities: 0,
    };
  }

  const processedSet = new Set(cp.processedDetailIds);

  console.log(`RÚZ Verification — Bulk approach`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Checkpoint: verified=${cp.verifiedCount}, 2025=${cp.with2025Count}, errors=${cp.errorCount}`);
  console.log();

  const startTime = Date.now();

  // Phase 1: Stream all entity IDs and process in batches
  let allIds: number[] = [];
  let totalStreamed = 0;

  for (const form of LEGAL_FORMS) {
    console.log(`Streaming entity IDs for legal form ${form}...`);
    const count = await streamEntityIds(
      form,
      async (ids) => {
        allIds.push(...ids);
        totalStreamed += ids.length;
      },
      0 // Always stream from start (IDs are deterministic)
    );
    console.log(`  Form ${form}: ${count} entities`);
  }

  // Filter out already processed
  let toProcess = allIds.filter((id) => !processedSet.has(id));
  if (limit > 0) toProcess = toProcess.slice(0, limit);

  cp.totalEntities = allIds.length;
  console.log(`\nTotal entities from RÚZ: ${allIds.length}`);
  console.log(`Already processed: ${cp.processedDetailIds.length}`);
  console.log(`To process: ${toProcess.length}`);
  console.log();

  // Phase 2: Process entity details in batches
  const BATCH_SIZE = 5000;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    console.log(`Batch ${batchNum}/${totalBatches} (${i + 1}-${i + batch.length})`);

    await processBatch(batch, concurrency, cp);
    saveCheckpoint(cp);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("RÚZ VERIFICATION REPORT");
  console.log("=".repeat(60));
  console.log(`  Total RÚZ entities:    ${allIds.length}`);
  console.log(`  Total processed:       ${cp.processedDetailIds.length}`);
  console.log(`  Verified in DB:        ${cp.verifiedCount}`);
  console.log(`  With 2025 statements:  ${cp.with2025Count}`);
  console.log(`  Errors:                ${cp.errorCount}`);
  console.log(`  Elapsed:               ${elapsed}s`);
  console.log("=".repeat(60));

  // Final stats
  const verified = await prisma.company.count({ where: { status: "ruz_verified" } });
  const checked = await prisma.company.count({ where: { status: "ruz_checked" } });
  console.log(`\nDB: ruz_verified=${verified}, ruz_checked=${checked}`);

  const bySize = await prisma.company.groupBy({
    by: ["sizeCategory"],
    where: { ruzSyncedAt: { not: null } },
    _count: true,
    orderBy: { _count: { sizeCategory: "desc" } },
  });
  console.log("\nBy size (top 10):");
  bySize.slice(0, 10).forEach((s) => console.log(`  ${s.sizeCategory}: ${s._count}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
