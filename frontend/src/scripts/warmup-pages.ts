/**
 * Warmup script — prerenderuje a zcacheuje firemné profily na webe.
 *
 * Prejde všetky firmy s latestYear IS NOT NULL (majú finančné dáta)
 * a zavolá http://localhost:3000/firma/{ico} aby Next.js ISR cache
 * vygeneroval stránku. Googlebot tak dostane okamžite hotovú stránku.
 *
 * Usage:
 *   npx tsx src/scripts/warmup-pages.ts --concurrency=5 --base-url=http://localhost:3000
 *   npx tsx src/scripts/warmup-pages.ts --concurrency=10 --priority   // top firmy podľa zamestnancov
 *   npx tsx src/scripts/warmup-pages.ts --resume                        // pokračuje od checkpointu
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env.WARMUP_BASE_URL || "http://localhost:3000";
const CHECKPOINT_FILE = "warmup-checkpoint.json";
const DEFAULT_CONCURRENCY = 5;
const BATCH_SIZE = 5000;
const REQUEST_DELAY_MS = 100;

// ─── Checkpoint ───────────────────────────────────────────────────────────────

interface Checkpoint {
  processedIcos: string[];
  totalRequests: number;
  totalOk: number;
  totalErrors: number;
}

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { processedIcos: [], totalRequests: 0, totalOk: 0, totalErrors: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const baseUrlArg = args.find((a) => a.startsWith("--base-url="));
const maxArg = args.find((a) => a.startsWith("--max="));
const resumeArg = args.includes("--resume");
const priorityArg = args.includes("--priority");

const concurrency = concurrencyArg
  ? parseInt(concurrencyArg.split("=")[1])
  : DEFAULT_CONCURRENCY;
const baseUrl = baseUrlArg ? baseUrlArg.split("=")[1] : BASE_URL;
const max = maxArg ? parseInt(maxArg.split("=")[1]) : 0;

// ─── HTTP fetch with retry ────────────────────────────────────────────────────

async function warmupUrl(url: string, retries = 2): Promise<number> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
      const res = await fetch(url, {
        headers: { "User-Agent": "Verifa-Warmup/1.0 (internal)" },
        signal: AbortSignal.timeout(30000),
      });
      return res.status;
    } catch (e) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return 0;
    }
  }
  return 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Page Warmup — ISR Cache Pre-generation");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Base URL:    ${baseUrl}`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Priority:    ${priorityArg ? "yes (by employeeCount desc)" : "no (by ico asc)"}`);
  console.log(`  Max:         ${max > 0 ? max : "unlimited"}`);
  console.log();

  let cp = loadCheckpoint();
  if (resumeArg && cp.processedIcos.length > 0) {
    console.log(`  Resuming from checkpoint: ${cp.processedIcos.length} already processed`);
  } else if (!resumeArg) {
    cp = { processedIcos: [], totalRequests: 0, totalOk: 0, totalErrors: 0 };
  }

  const processedSet = new Set(cp.processedIcos);

  // Fetch companies with financial data
  console.log("Fetching companies with latestYear IS NOT NULL...");
  const companies = await prisma.company.findMany({
    where: {
      latestYear: { not: null },
    },
    select: { ico: true, name: true, employeeCount: true },
    orderBy: priorityArg
      ? [{ employeeCount: "desc" }, { ico: "asc" }]
      : [{ ico: "asc" }],
    take: max > 0 ? max + processedSet.size : undefined,
  });

  const toProcess = companies.filter((c) => !processedSet.has(c.ico));
  if (max > 0) toProcess.length = Math.min(toProcess.length, max);

  console.log(`Total companies with financials: ${companies.length}`);
  console.log(`To process: ${toProcess.length}`);
  console.log();

  if (!toProcess.length) {
    console.log("Nothing to do — all pages already warmed up.");
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let ok = 0;
  let errors = 0;

  // Process in batches
  for (let batchStart = 0; batchStart < toProcess.length; batchStart += BATCH_SIZE) {
    const batch = toProcess.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);
    console.log(`\nBatch ${batchNum}/${totalBatches} (${batchStart + 1}-${batchStart + batch.length})`);

    // Process with concurrency limit
    let idx = 0;
    const results: { ico: string; status: number }[] = [];

    async function worker() {
      while (idx < batch.length) {
        const i = idx++;
        const company = batch[i];
        const url = `${baseUrl}/firma/${company.ico}`;
        const status = await warmupUrl(url);
        results.push({ ico: company.ico, status });

        if (status === 200) ok++;
        else errors++;

        processed++;
        cp.totalRequests++;
        if (status === 200) cp.totalOk++;
        else cp.totalErrors++;
        cp.processedIcos.push(company.ico);

        if (processed % 100 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          const rate = processed / elapsed;
          const remaining = (toProcess.length - processed) / rate;
          console.log(
            `  [${processed}/${toProcess.length}] OK=${ok} ERR=${errors} ` +
              `(${rate.toFixed(1)}/s, ETA ${formatTime(remaining)})`
          );
          saveCheckpoint(cp);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Save checkpoint after each batch
    saveCheckpoint(cp);

    const batchOk = results.filter((r) => r.status === 200).length;
    const batchErr = results.filter((r) => r.status !== 200).length;
    console.log(
      `  Batch done: OK=${batchOk} ERR=${batchErr} ` +
        `(${batchErr > 0 ? results.filter((r) => r.status !== 200).slice(0, 5).map((r) => `${r.ico}:${r.status}`).join(", ") : "all OK"})`
    );
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  WARMUP REPORT");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Total processed:  ${processed}`);
  console.log(`  OK (200):         ${ok}`);
  console.log(`  Errors:           ${errors}`);
  console.log(`  Elapsed:          ${formatTime(elapsed)} (${(processed / elapsed).toFixed(1)} pages/s)`);
  console.log("═══════════════════════════════════════════════════════════════");

  await prisma.$disconnect();
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
