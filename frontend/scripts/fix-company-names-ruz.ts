/**
 * One-off repair: fix company names corrupted by the RPO dump import.
 *
 * ROOT CAUSE (2026-09-06): seed-rpo-dump.ts::extractName() took
 * `fullNames[0]` — the OLDEST name in the RPO name-history array — and
 * overwrote Company.name for every company that has ever renamed itself
 * (~36% of a 25-company sample; e.g. Kia Slovakia showed as "Vilko s.r.o.",
 * its 2004 predecessor name).
 *
 * FIX STRATEGY: RÚZ API returns the CURRENT official name (nazovUJ).
 * We stored `ruzEntityId` on Company during RÚZ syncs, so no search call is
 * needed — one direct fetch per company. Names are compared normalized
 * (case/punctuation-insensitive) to avoid touching formatting-only diffs.
 *
 * Usage (on the server, in screen):
 *   npx tsx scripts/fix-company-names-ruz.ts [--dry-run] [--limit N] [--resume]
 *
 * Checkpoint: /tmp/fix-names-checkpoint.json (last processed IČO) — the
 * script is resumable and safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";
const BATCH_SIZE = 200;
const DELAY_MS = 120; // ~8 req/s — well under RÚZ limits
const CHECKPOINT_FILE = "/tmp/fix-names-checkpoint.json";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESUME = args.includes("--resume");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bs\.?\s*r\.?\s*o\.?/g, "")
    .replace(/\bspoločnosť s ručením obmedzeným\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function ruzEntityName(entityId: number): Promise<string | null> {
  const url = `${RUZ_API}/uctovna-jednotka?id=${entityId}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { nazovUJ?: string };
      return data.nazovUJ?.trim() || null;
    } catch (e) {
      if (attempt === 2) {
        console.error(`[fix-names] entity ${entityId} failed after 3 attempts:`, (e as Error).message);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

async function loadCheckpoint(): Promise<string | null> {
  if (!RESUME) return null;
  try {
    const fs = await import("fs");
    const cp = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    return cp.lastIco ?? null;
  } catch {
    return null;
  }
}

async function saveCheckpoint(lastIco: string): Promise<void> {
  const fs = await import("fs");
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastIco, at: new Date().toISOString() }));
}

async function main() {
  const startAfter = await loadCheckpoint();
  console.log(`[fix-names] start — dryRun=${DRY_RUN} resumeFrom=${startAfter ?? "beginning"} limit=${LIMIT || "none"}`);

  let cursor: string | null = startAfter;
  let processed = 0;
  let fixed = 0;
  let skippedSame = 0;
  let skippedNoRuz = 0;
  let errors = 0;

  while (true) {
    const companies = await prisma.company.findMany({
      where: {
        ico: cursor ? { gt: cursor } : undefined,
        ruzEntityId: { not: null },
        name: { not: null },
      },
      select: { ico: true, name: true, ruzEntityId: true },
      orderBy: { ico: "asc" },
      take: BATCH_SIZE,
    });
    if (companies.length === 0) break;

    for (const c of companies) {
      processed++;
      cursor = c.ico;

      const ruzName = await ruzEntityName(c.ruzEntityId!);
      if (ruzName === null) {
        skippedNoRuz++;
        continue;
      }

      if (normalizeName(ruzName) === normalizeName(c.name!)) {
        skippedSame++;
        continue;
      }

      // Real difference — fix it
      fixed++;
      console.log(`[fix-names] ${c.ico}: ${c.name!} → ${ruzName}`);
      if (!DRY_RUN) {
        await prisma.company.update({
          where: { ico: c.ico },
          data: { name: ruzName },
        });
      }

      if (processed % 50 === 0) {
        console.log(`[fix-names] progress: processed=${processed} fixed=${fixed} same=${skippedSame} noRuz=${skippedNoRuz} errors=${errors}`);
        if (!DRY_RUN) await saveCheckpoint(c.ico);
      }
      if (LIMIT && fixed >= LIMIT) {
        console.log(`[fix-names] reached --limit ${LIMIT}, stopping`);
        cursor = null;
        break;
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    if (cursor === null) break;
    if (!DRY_RUN && companies.length > 0) await saveCheckpoint(companies[companies.length - 1].ico);
  }

  console.log(
    `[fix-names] DONE — processed=${processed} fixed=${fixed} same=${skippedSame} ` +
    `noRuzName=${skippedNoRuz} errors=${errors} dryRun=${DRY_RUN}`
  );
}

main()
  .catch((e) => {
    console.error("[fix-names] fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
