#!/usr/bin/env npx tsx
/**
 * Bulk import companies from RPO (Register právnických osôb) offline dump.
 *
 * Downloads JSON.gz files from Oracle Cloud S3 (MV SR open data),
 * parses each record, filters for PO with valid IČO, and upserts
 * into the Company + CompanyPerson tables.
 *
 * Usage:
 *   npx tsx src/scripts/seed-rpo-dump.ts                    # full import (all init files)
 *   npx tsx src/scripts/seed-rpo-dump.ts --max-files=3      # limit number of files
 *   npx tsx src/scripts/seed-rpo-dump.ts --resume           # resume from checkpoint
 *   npx tsx src/scripts/seed-rpo-dump.ts --file=init_2026-08-01_001.json.gz
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { createGunzip } from "zlib";

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const S3_BASE =
  "https://frkqbrydxwdp.compat.objectstorage.eu-frankfurt-1.oraclecloud.com/susr-rpo";
const INIT_PREFIX = "batch-init/";
const CHECKPOINT_FILE = "seed-rpo-checkpoint.json";
const TMP_DIR = "/tmp/rpo-dump";
const BATCH_SIZE = 500;

const ORSR_LEGAL_FORMS = new Set([
  "112", "121", "113", "114", "118", "116", "119", "331", "333",
]);

const LEGAL_FORM_MAP: Record<string, string> = {
  "112": "s.r.o.", "121": "a.s.", "113": "v.o.s.", "114": "k.s.",
  "118": "družstvo", "116": "európska spoločnosť", "119": "štátny podnik",
  "331": "európske družstvo", "333": "európska spoločnosť",
};

const TITLE_RE =
  /^(Ing\.|Mgr\.|JUDr\.|MUDr\.|MDDr\.|MVDr\.|BC\.|BCa\.|PhDr\.|RNDr\.|PharmDr\.|ThDr\.|ThLic\.|PaedDr\.|Prof\.|Doc\.|PhD\.|DBA\.|EDD\.|DSc\.|DrSc\.|CSc\.|DIS\.|etds\.|MBA\.|LL\.M\.|LL\.B\.|LL\.D\.|J\.D\.)\s+/i;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RpoRecord {
  id: number;
  identifiers?: { value: string }[];
  fullNames?: { value: string }[];
  addresses?: {
    street?: string;
    regNumber?: number;
    buildingNumber?: string;
    postalCodes?: string[];
    municipality?: { value: string };
    country?: { value: string };
  }[];
  legalForms?: { value: { code: string; value: string } }[];
  establishment?: string;
  activities?: { economicActivityDescription: string }[];
  statutoryBodies?: {
    stakeholderType?: { value: string };
    validFrom?: string;
    personName?: {
      formatedName?: string;
      givenNames?: string[];
      familyNames?: string[];
    };
    address?: { street?: string; municipality?: { value: string }; postalCodes?: string[] };
  }[];
}

interface Checkpoint {
  processedFiles: string[];
  totalRecords: number;
  totalCompanies: number;
  totalPersons: number;
}

interface ExtPerson {
  rawName: string;
  cleanName: string;
  role: string;
  city: string | null;
  street: string | null;
  zipCode: string | null;
  functionStart: Date | null;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
  }
  return { processedFiles: [], totalRecords: 0, totalCompanies: 0, totalPersons: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ─── Field extractors ─────────────────────────────────────────────────────────

function extractIco(r: RpoRecord): string | null {
  const ico = r.identifiers?.[0]?.value?.trim();
  if (!ico || !/^\d{8}$/.test(ico)) return null;
  return ico;
}

function extractLegalFormCode(r: RpoRecord): string | null {
  return r.legalForms?.[0]?.value?.code || null;
}

function extractName(r: RpoRecord): string | null {
  return r.fullNames?.[0]?.value?.trim() || null;
}

function extractLegalForm(r: RpoRecord): string | null {
  const code = extractLegalFormCode(r);
  if (!code) return null;
  return LEGAL_FORM_MAP[code] || r.legalForms?.[0]?.value?.value || null;
}

function extractAddress(r: RpoRecord) {
  const a = r.addresses?.[0];
  if (!a) return { city: null, street: null, zipCode: null, country: null };
  const street = [a.street, a.regNumber ? String(a.regNumber) : null, a.buildingNumber]
    .filter(Boolean).join(" ").trim() || null;
  return {
    city: a.municipality?.value || null,
    street,
    zipCode: a.postalCodes?.[0] || null,
    country: a.country?.value || null,
  };
}

function extractEstablishment(r: RpoRecord): Date | null {
  if (!r.establishment || !/^\d{4}-\d{2}-\d{2}/.test(r.establishment)) return null;
  return new Date(r.establishment + "T00:00:00.000Z");
}

function extractActivities(r: RpoRecord): string | null {
  if (!r.activities?.length) return null;
  return r.activities.map((a) => a.economicActivityDescription).join("; ").slice(0, 2000);
}

function extractPersons(r: RpoRecord): ExtPerson[] {
  if (!r.statutoryBodies?.length) return [];
  const persons: ExtPerson[] = [];
  for (const body of r.statutoryBodies) {
    const roleText = body.stakeholderType?.value || "štatutár";
    const role = roleText.toLowerCase().includes("dozorn") ? "dozorna_rada" : "statutar";

    // personName.formatedName is the full name
    let rawName = body.personName?.formatedName || "";
    if (!rawName && body.personName) {
      const given = body.personName.givenNames?.join(" ") || "";
      const family = body.personName.familyNames?.join(" ") || "";
      rawName = [given, family].filter(Boolean).join(" ").trim();
    }
    if (!rawName) continue;

    const cleanName = rawName.replace(TITLE_RE, "").replace(/\s+(Ing\.|Mgr\.|JUDr\.|PhD\.|DBA\.|MBA\.)\s+/gi, " ").trim();

    persons.push({
      rawName: rawName.trim(),
      cleanName: cleanName || rawName.trim(),
      role,
      city: body.address?.municipality?.value || null,
      street: body.address?.street || null,
      zipCode: body.address?.postalCodes?.[0] || null,
      functionStart: body.validFrom ? new Date(body.validFrom + "T00:00:00.000Z") : null,
    });
  }
  return persons;
}

// ─── S3 listing ───────────────────────────────────────────────────────────────

async function listInitFiles(): Promise<string[]> {
  const url = `${S3_BASE}/?list-type=2&prefix=${INIT_PREFIX}`;
  const res = await fetch(url, { headers: { "User-Agent": "Verifa.sk/1.0" } });
  const xml = await res.text();
  const files: string[] = [];
  const regex = /<Key>(batch-init\/[^<]+\.json\.gz)<\/Key>/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) files.push(m[1]);
  return files.sort();
}

// ─── Download ─────────────────────────────────────────────────────────────────

async function downloadFile(key: string): Promise<string> {
  const filename = path.basename(key);
  const localPath = path.join(TMP_DIR, filename);

  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 1000) {
    console.log(`  Cached: ${filename} (${(fs.statSync(localPath).size / 1024 / 1024).toFixed(1)} MB)`);
    return localPath;
  }

  console.log(`  Downloading: ${filename}...`);
  const res = await fetch(`${S3_BASE}/${key}`, { headers: { "User-Agent": "Verifa.sk/1.0" } });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

  const ws = fs.createWriteStream(localPath);
  const reader = (res.body as any).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    ws.write(value);
  }
  ws.end();
  await new Promise((r) => ws.on("finish", r));
  console.log(`  Downloaded: ${filename} (${(fs.statSync(localPath).size / 1024 / 1024).toFixed(1)} MB)`);
  return localPath;
}

// ─── JSON brace-counting parser ───────────────────────────────────────────────
// Given a buffer string and current state, extracts complete JSON objects.
// Returns { records, restBuffer, done }.

interface ParseState {
  buffer: string;
  inResults: boolean;
  depth: number;
  objStart: number;
  inString: boolean;
  escape: boolean;
  pos: number;
}

function parseChunk(state: ParseState, maxRecords: number): { records: RpoRecord[]; state: ParseState; done: boolean } {
  const records: RpoRecord[] = [];
  let { buffer, inResults, depth, objStart, inString, escape, pos } = state;

  if (!inResults) {
    const idx = buffer.indexOf('"results":[');
    if (idx === -1) {
      return { records, state: { buffer: buffer.slice(-20), inResults: false, depth: 0, objStart: -1, inString: false, escape: false, pos: 0 }, done: false };
    }
    inResults = true;
    pos = idx + 11;
  }

  while (pos < buffer.length) {
    const ch = buffer[pos];

    if (escape) { escape = false; pos++; continue; }
    if (ch === "\\") { escape = true; pos++; continue; }
    if (ch === '"') { inString = !inString; pos++; continue; }
    if (inString) { pos++; continue; }

    if (ch === "{") {
      if (depth === 0) objStart = pos;
      depth++;
      pos++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try { records.push(JSON.parse(buffer.slice(objStart, pos + 1))); } catch { /* skip */ }
        buffer = buffer.slice(pos + 1);
        objStart = -1;
        depth = 0;
        pos = 0;
        if (records.length >= maxRecords) return { records, state: { buffer, inResults, depth, objStart, inString, escape, pos }, done: false };
        continue;
      }
      pos++;
    } else if (ch === "]" && depth === 0) {
      return { records, state: { buffer: "", inResults: false, depth: 0, objStart: -1, inString: false, escape: false, pos: 0 }, done: true };
    } else { pos++; }
  }

  return { records, state: { buffer, inResults, depth, objStart, inString, escape, pos }, done: false };
}

// ─── Stream parse a gzipped file ──────────────────────────────────────────────

async function streamParseFile(
  filepath: string,
  onBatch: (records: RpoRecord[]) => Promise<void>
): Promise<number> {
  const stream = fs.createReadStream(filepath, { highWaterMark: 256 * 1024 }).pipe(createGunzip());

  let state: ParseState = { buffer: "", inResults: false, depth: 0, objStart: -1, inString: false, escape: false, pos: 0 };
  let totalParsed = 0;
  let batch: RpoRecord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const toSend = batch;
    batch = [];
    await onBatch(toSend);
    totalParsed += toSend.length;
    if (totalParsed % 10000 === 0) console.log(`    Parsed ${totalParsed}...`);
  };

  for await (const chunk of stream as any) {
    state.buffer += chunk.toString("utf-8");

    const result = parseChunk(state, BATCH_SIZE);
    batch.push(...result.records);
    state = result.state;

    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }

  // Parse any remaining buffer
  if (state.buffer.length > 0 && state.pos < state.buffer.length) {
    const result = parseChunk(state, BATCH_SIZE);
    batch.push(...result.records);
  }

  await flush();
  return totalParsed;
}

// ─── DB upsert ────────────────────────────────────────────────────────────────

async function upsertBatch(records: RpoRecord[]): Promise<{ companies: number; persons: number }> {
  const filtered = records.filter((r) => {
    const ico = extractIco(r);
    const lf = extractLegalFormCode(r);
    return ico && lf && ORSR_LEGAL_FORMS.has(lf);
  });

  if (filtered.length === 0) return { companies: 0, persons: 0 };

  let companies = 0;
  let persons = 0;

  await prisma.$transaction(async (tx) => {
    for (const r of filtered) {
      const ico = extractIco(r)!;
      const name = extractName(r);
      const legalForm = extractLegalForm(r);
      const addr = extractAddress(r);
      const establishedAt = extractEstablishment(r);
      const activities = extractActivities(r);
      const rpoPersons = extractPersons(r);

      await tx.company.upsert({
        where: { ico },
        create: {
          ico,
          name: name || undefined,
          legalForm: legalForm || undefined,
          city: addr.city || undefined,
          street: addr.street || undefined,
          zipCode: addr.zipCode || undefined,
          country: addr.country || "Slovenská republika",
          establishedAt: establishedAt || undefined,
          status: "active",
          statusNormalized: "ACTIVE",
          sizeCategoryNormalized: "unknown",
          businessActivity: activities || undefined,
        },
        update: {
          name: name || undefined,
          legalForm: legalForm || undefined,
          city: addr.city || undefined,
          street: addr.street || undefined,
          zipCode: addr.zipCode || undefined,
          country: addr.country || undefined,
          establishedAt: establishedAt || undefined,
          status: "active",
          statusNormalized: "ACTIVE",
          sizeCategoryNormalized: "unknown",
          businessActivity: activities || undefined,
        },
      });
      companies++;

      if (rpoPersons.length > 0) {
        await tx.companyPerson.deleteMany({ where: { companyIco: ico } });
        await tx.companyPerson.createMany({
          data: rpoPersons.map((p) => ({
            companyIco: ico,
            rawName: p.rawName,
            cleanName: p.cleanName,
            role: p.role,
            city: p.city,
            street: p.street,
            zipCode: p.zipCode,
            functionStart: p.functionStart,
          })),
        });
        persons += rpoPersons.length;
      }
    }
  });

  return { companies, persons };
}

// ─── Process one file ─────────────────────────────────────────────────────────

async function processFile(filepath: string, cp: Checkpoint): Promise<void> {
  let companies = 0;
  let persons = 0;

  const onBatch = async (records: RpoRecord[]) => {
    const stats = await upsertBatch(records);
    companies += stats.companies;
    persons += stats.persons;
  };

  const total = await streamParseFile(filepath, onBatch);

  cp.totalRecords += total;
  cp.totalCompanies += companies;
  cp.totalPersons += persons;

  console.log(`    Parsed: ${total}, Companies: ${companies}, Persons: ${persons}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const maxFilesArg = args.find((a) => a.startsWith("--max-files="));
  const maxFiles = maxFilesArg ? parseInt(maxFilesArg.split("=")[1]) : undefined;
  const singleFileArg = args.find((a) => a.startsWith("--file="));
  const resume = args.includes("--resume");

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const cp = resume
    ? loadCheckpoint()
    : { processedFiles: [], totalRecords: 0, totalCompanies: 0, totalPersons: 0 };

  let filesToProcess: string[];
  if (singleFileArg) {
    filesToProcess = [`${INIT_PREFIX}${singleFileArg.split("=")[1]}`];
  } else {
    console.log("Listing init batch files from S3...");
    const allFiles = await listInitFiles();
    console.log(`Found ${allFiles.length} init files\n`);
    filesToProcess = allFiles.filter((f) => !cp.processedFiles.includes(f));
    if (maxFiles) filesToProcess = filesToProcess.slice(0, maxFiles);
  }

  console.log(`Files to process: ${filesToProcess.length}`);
  console.log(`Checkpoint: ${cp.processedFiles.length} done, ${cp.totalCompanies} companies\n`);

  const dbBefore = await prisma.company.count();
  console.log(`DB companies before: ${dbBefore}\n`);

  const startTime = Date.now();

  for (let fi = 0; fi < filesToProcess.length; fi++) {
    const fileKey = filesToProcess[fi];
    const filename = path.basename(fileKey);
    console.log(`[${fi + 1}/${filesToProcess.length}] ${filename}`);

    try {
      const localPath = await downloadFile(fileKey);
      await processFile(localPath, cp);
      cp.processedFiles.push(fileKey);
      saveCheckpoint(cp);

      if (!singleFileArg) {
        fs.unlinkSync(localPath);
        console.log(`  Cleaned up\n`);
      }
    } catch (e) {
      console.error(`  ERROR: ${filename}:`, e);
      saveCheckpoint(cp);
    }
  }

  const dbAfter = await prisma.company.count();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n" + "=".repeat(60));
  console.log("RPO IMPORT REPORT");
  console.log("=".repeat(60));
  console.log(`  Files processed:       ${cp.processedFiles.length}`);
  console.log(`  Total records parsed:  ${cp.totalRecords}`);
  console.log(`  Companies upserted:    ${cp.totalCompanies}`);
  console.log(`  Persons upserted:      ${cp.totalPersons}`);
  console.log(`  DB companies before:   ${dbBefore}`);
  console.log(`  DB companies after:    ${dbAfter}`);
  console.log(`  Elapsed:               ${elapsed}s`);
  console.log("=".repeat(60));
}

main().catch(console.error).finally(() => prisma.$disconnect());
