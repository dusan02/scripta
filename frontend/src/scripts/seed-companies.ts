#!/usr/bin/env npx tsx
/**
 * Bulk seed company metadata from RÚZ API.
 *
 * Usage:
 *   npx tsx src/scripts/seed-companies.ts              # all entities
 *   npx tsx src/scripts/seed-companies.ts --max 1000   # limit
 *   npx tsx src/scripts/seed-companies.ts --resume     # resume from checkpoint
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();
const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const CHECKPOINT_FILE = "seed-companies-checkpoint.json";
const BATCH_DELAY_MS = 500;
const MAX_CONCURRENT = 10;

const LEGAL_FORM_MAP: Record<string, string> = {
  "000": "Neurčené",
  "100": "FO v RDIS", "101": "Živnostník", "102": "Živnostník v OR",
  "103": "SHR roľník", "104": "SHR roľník v OR", "105": "FO slob. povolanie",
  "106": "FO slob. povolanie v OR", "107": "Živ. a SHR roľník", "108": "Živ. a SHR roľník v OR",
  "109": "Živ. a sl. povolanie", "110": "Živ. a sl. povolanie v OR",
  "111": "Ver. obch. spol.", "112": "s.r.o.", "113": "v.o.s.",
  "114": "Kom. spol. na akcie", "115": "Spoločný podnik",
  "116": "Záujmové združenie", "117": "Nadácia", "118": "Neinvestičný fond",
  "119": "Štátny podnik", "120": "Rozpočtová org.", "121": "Príspevková org.",
  "122": "Príspevková org.", "123": "Nezisková org.", "124": "Občianske združenie",
  "125": "Nadácia", "126": "Fond", "127": "NOPS",
  "205": "Európske združenie", "301": "Akciová spol.", "321": "Družstvo",
  "331": "Európske družstvo", "333": "Európska spol.",
  "382": "Organiz. zahr. investora",
  "701": "Rozpočtová org. štátu", "711": "Príspevková org. štátu",
  "721": "Štátny fond", "751": "Zariadenie štátu",
  "801": "Obec", "271": "Záujmové združenie FO",
  "272": "Politická strana", "234": "Cirkevná org.",
  "141": "Nadácia v zriaďovateľskej fáze",
};

const SIZE_MAP: Record<string, string> = {
  "00": "Nezistený", "01": "0 zamestnancov", "02": "1 zamestnanec",
  "03": "2 zamestnanci", "04": "3-4 zamestnanci", "05": "5-9 zamestnancov",
  "06": "10-19 zamestnancov", "07": "20-24 zamestnancov",
  "11": "25-49 zamestnancov", "12": "50-99 zamestnancov",
  "21": "100-149 zamestnancov", "22": "150-199 zamestnancov",
  "23": "200-249 zamestnancov", "24": "250-499 zamestnancov",
  "25": "500-999 zamestnancov", "31": "1000-1999 zamestnancov",
  "32": "2000-2999 zamestnancov", "33": "3000-3999 zamestnancov",
  "34": "4000-4999 zamestnancov", "35": "5000-9999 zamestnancov",
};

const OWNERSHIP_MAP: Record<string, string> = {
  "0": "Nezistené", "1": "Medzinárodné - verejné", "2": "Súkromné tuzemské",
  "3": "Družstevné", "4": "Štátne", "5": "Vlast. územnej samosprávy",
  "6": "Združ., p. strany, cirkvi", "7": "Zahraničné",
  "8": "Medzinárodné - súkromné", "9": "Zmiešané",
};

async function ruzGet(endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const url = new URL(`${RUZ_API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const resp = await fetch(url.toString(), { headers: { "User-Agent": UA } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

interface Checkpoint {
  lastEntityId: number;
  totalProcessed: number;
  totalCompanies: number;
}

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { lastEntityId: 0, totalProcessed: 0, totalCompanies: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function upsertCompany(entity: any): Promise<boolean> {
  const ico = (entity.ico || "").toString().trim();
  if (!ico || !/^\d{8}$/.test(ico)) return false;

  const legalForm = LEGAL_FORM_MAP[String(entity.pravnaForma || "")] || entity.pravnaForma || null;
  const sizeCat = SIZE_MAP[String(entity.velkostOrganizacie || "")] || entity.velkostOrganizacie || null;
  const ownership = OWNERSHIP_MAP[String(entity.druhVlastnictva || "")] || entity.druhVlastnictva || null;

  let naceText: string | null = null;
  if (entity.skNace) {
    const naceData = await ruzGet("sk-nace", { id: entity.skNace });
    naceText = naceData?.nazovUJ?.sk || null;
  }

  // Convert date string to ISO DateTime if present
  let establishedAt: string | null = null;
  if (entity.datumZalozenia) {
    const d = entity.datumZalozenia;
    if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
      establishedAt = new Date(d + "T00:00:00.000Z").toISOString();
    }
  }

  await prisma.company.upsert({
    where: { ico },
    create: {
      ico,
      name: entity.nazovUJ || null,
      legalForm,
      city: entity.mesto || null,
      street: entity.ulica || null,
      zipCode: entity.psc ? String(entity.psc) : null,
      country: "Slovensko",
      establishedAt,
      status: "active",
      naceCode: entity.skNace || null,
      naceText,
      ownershipType: ownership,
      sizeCategory: sizeCat,
      employeeCount: entity.pocetZamestnancov || null,
    },
    update: {
      name: entity.nazovUJ || null,
      legalForm,
      city: entity.mesto || null,
      street: entity.ulica || null,
      zipCode: entity.psc ? String(entity.psc) : null,
      establishedAt,
      naceCode: entity.skNace || null,
      naceText,
      ownershipType: ownership,
      sizeCategory: sizeCat,
      employeeCount: entity.pocetZamestnancov || null,
    },
  });
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const maxIdx = args.indexOf("--max");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxCompanies = maxArg
    ? parseInt(maxArg.split("=")[1])
    : maxIdx >= 0 && args[maxIdx + 1]
    ? parseInt(args[maxIdx + 1])
    : undefined;

  const resume = args.includes("--resume");
  const cp = resume ? loadCheckpoint() : { lastEntityId: 0, totalProcessed: 0, totalCompanies: 0 };
  console.log(`Target: ${maxCompanies || "all"} companies | Checkpoint: last_id=${cp.lastEntityId}, processed=${cp.totalProcessed}, companies=${cp.totalCompanies}`);

  const dbBefore = await prisma.company.count();
  console.log(`DB companies before: ${dbBefore}`);

  const startTime = Date.now();
  const ENTITY_BATCH = 100;
  const ID_PAGE_SIZE = 10000;

  // Stats for final report
  let entitiesFetched = 0;
  let entitiesProcessed = 0;
  let validIco = 0;
  let skippedNoIco = 0;
  let skippedApiError = 0;
  let duplicates = 0;
  let activeCount = 0;
  let inactiveCount = 0;
  let withFinancials = 0;
  const seenIcos = new Set<string>();

  // Stream entity IDs from RÚZ API, process in batches, stop at maxCompanies
  let currentId = cp.lastEntityId;
  let page = 0;
  let prevFirstId = -1;

  while (true) {
    // Fetch next page of entity IDs
    const params: Record<string, string | number> = {
      "zmenene-od": "2000-01-01",
      "max-zaznamov": ID_PAGE_SIZE,
    };
    if (currentId > 0) params["pokracovat-za-id"] = currentId;

    const data = await ruzGet("uctovne-jednotky", params);
    if (!data?.id?.length) {
      console.log("No more entity IDs from RÚZ API.");
      break;
    }

    const pageIds: number[] = data.id;
    const firstId = pageIds[0];

    // Safety guard: abort if pagination cursor does not advance
    if (firstId === prevFirstId) {
      console.error(`Pagination stuck! firstId=${firstId} same as previous page. Aborting.`);
      break;
    }
    prevFirstId = firstId;
    entitiesFetched += pageIds.length;
    currentId = pageIds[pageIds.length - 1];
    page++;
    console.log(`\nPage ${page}: ${pageIds.length} IDs (first=${pageIds[0]} last=${currentId}, total fetched=${entitiesFetched})`);

    // Process this page in batches
    for (let i = 0; i < pageIds.length; i += ENTITY_BATCH) {
      // Check if we've reached the target
      if (maxCompanies && cp.totalCompanies >= maxCompanies) break;

      const batch = pageIds.slice(i, i + ENTITY_BATCH);
      const sem = new Semaphore(MAX_CONCURRENT);
      let batchUpserted = 0;

      await Promise.all(
        batch.map(async (eid) => {
          await sem.acquire();
          try {
            const entity = await ruzGet("uctovna-jednotka", { id: eid });
            entitiesProcessed++;

            if (!entity) {
              skippedApiError++;
              return;
            }

            const ico = (entity.ico || "").toString().trim();
            if (!ico || !/^\d{8}$/.test(ico)) {
              skippedNoIco++;
              return;
            }

            validIco++;

            // Track duplicates (same IČO seen before in this run)
            if (seenIcos.has(ico)) {
              duplicates++;
            } else {
              seenIcos.add(ico);
            }

            // Track active/inactive
            if (entity.datumZrusenia) inactiveCount++;
            else activeCount++;

            // Track financials
            if (entity.idUctovnychZavierok && entity.idUctovnychZavierok.length > 0) {
              withFinancials++;
            }

            await upsertCompany(entity);
            batchUpserted++;
          } finally {
            sem.release();
          }
        })
      );

      cp.totalProcessed += batch.length;
      cp.totalCompanies += batchUpserted;
      cp.lastEntityId = batch[batch.length - 1];
      saveCheckpoint(cp);

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = cp.totalProcessed / (elapsed || 1);
      console.log(
        `  Progress: ${cp.totalCompanies}/${maxCompanies || "∞"} companies ` +
          `(${cp.totalProcessed} entities, rate=${rate.toFixed(0)}/s, last_id=${cp.lastEntityId})`
      );

      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }

    // Check if we've reached the target after processing the page
    if (maxCompanies && cp.totalCompanies >= maxCompanies) {
      console.log(`\nTarget reached: ${cp.totalCompanies} companies (from ${cp.totalProcessed} entities).`);
      break;
    }

    if (pageIds.length < ID_PAGE_SIZE) {
      console.log("Last page reached (fewer than page size).");
      break;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  const dbAfter = await prisma.company.count();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Final report
  console.log("\n" + "=".repeat(60));
  console.log("SEED REPORT");
  console.log("=".repeat(60));
  console.log(`  RÚZ entities fetched:   ${entitiesFetched}`);
  console.log(`  Entities processed:     ${entitiesProcessed}`);
  console.log(`  Valid IČO:              ${validIco}`);
  console.log(`  Unique IČO:             ${seenIcos.size}`);
  console.log(`  Companies upserted:     ${cp.totalCompanies}`);
  console.log(`  Skipped (no IČO):       ${skippedNoIco}`);
  console.log(`  Skipped (API error):    ${skippedApiError}`);
  console.log(`  Duplicates (same IČO):  ${duplicates}`);
  console.log(`  Active:                 ${activeCount}`);
  console.log(`  Inactive:               ${inactiveCount}`);
  console.log(`  With závierky:          ${withFinancials}`);
  console.log(`  DB companies before:    ${dbBefore}`);
  console.log(`  DB companies after:     ${dbAfter}`);
  console.log(`  Elapsed:                ${elapsed}s`);
  console.log("=".repeat(60));
}

// Simple semaphore
class Semaphore {
  private available: number;
  private waiters: (() => void)[] = [];
  constructor(count: number) {
    this.available = count;
  }
  async acquire() {
    if (this.available > 0) {
      this.available--;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  release() {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      next();
    } else {
      this.available++;
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
