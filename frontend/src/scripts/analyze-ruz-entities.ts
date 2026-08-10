#!/usr/bin/env npx tsx
/**
 * Dry-run analysis of RÚZ entities — no DB writes.
 * Reports: IČO coverage, legal form distribution, size codes, skip reasons.
 *
 * Usage: npx tsx src/scripts/analyze-ruz-entities.ts --max=1000
 */

const RUZ_API = "https://www.registeruz.sk/cruz-public/api";
const UA = "Verifa.sk/1.0 (+https://verifa.sk)";

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

async function main() {
  const args = process.argv.slice(2);
  const maxIdx = args.indexOf("--max");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const max = maxArg
    ? parseInt(maxArg.split("=")[1])
    : maxIdx >= 0 && args[maxIdx + 1]
    ? parseInt(args[maxIdx + 1])
    : 1000;

  console.log(`Analyzing first ${max} RÚZ entities (dry-run, no DB writes)...\n`);

  // Fetch entity IDs
  const allIds: number[] = [];
  let currentId = 0;
  const PAGE_SIZE = 10000;

  while (allIds.length < max) {
    const params: Record<string, string | number> = {
      "zmenene-od": "2000-01-01",
      "max-zaznamov": Math.min(PAGE_SIZE, max - allIds.length),
    };
    if (currentId > 0) params["pokracovat-za-id"] = currentId;

    const data = await ruzGet("uctovne-jednotky", params);
    if (!data?.id?.length) break;
    allIds.push(...data.id);
    currentId = data.id[data.id.length - 1];
    if (data.id.length < (max - allIds.length + data.id.length)) break;
  }

  const ids = allIds.slice(0, max);
  console.log(`Fetched ${ids.length} entity IDs\n`);

  // Fetch entity details with concurrency
  const CONCURRENCY = 10;
  const stats = {
    total: 0,
    withIco: 0,
    withoutIco: 0,
    legalEntities: 0,
    physicalPersons: 0,
    other: 0,
    active: 0,
    dissolved: 0,
    hasFinancials: 0,
  };
  const legalForms: Record<string, number> = {};
  const sizeCats: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const entities = await Promise.all(
      batch.map(async (eid) => {
        return { id: eid, data: await ruzGet("uctovna-jednotka", { id: eid }) };
      })
    );

    for (const { id, data: e } of entities) {
      if (!e) {
        skipReasons["api_error"] = (skipReasons["api_error"] || 0) + 1;
        stats.total++;
        continue;
      }
      stats.total++;

      const ico = (e.ico || "").toString().trim();
      const legalForm = String(e.pravnaForma || "");
      const sizeCat = String(e.velkostOrganizacie || "");
      const dissolved = !!e.datumZrusenia;

      // IČO check
      if (!ico || !/^\d{8}$/.test(ico)) {
        stats.withoutIco++;
        skipReasons["no_ico"] = (skipReasons["no_ico"] || 0) + 1;
      } else {
        stats.withIco++;
      }

      // Legal form classification
      legalForms[legalForm] = (legalForms[legalForm] || 0) + 1;
      if (["101", "102"].includes(legalForm)) {
        stats.physicalPersons++;
      } else if (legalForm && legalForm !== "") {
        stats.legalEntities++;
      } else {
        stats.other++;
      }

      // Size category
      sizeCats[sizeCat] = (sizeCats[sizeCat] || 0) + 1;

      // Status
      if (dissolved) stats.dissolved++;
      else stats.active++;

      // Has financial statements?
      if (e.idUctovnychZavierok && e.idUctovnychZavierok.length > 0) {
        stats.hasFinancials++;
      }
    }

    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= ids.length) {
      console.log(`  Processed ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length}...`);
    }
  }

  // Report
  console.log("\n" + "=".repeat(60));
  console.log("ANALYSIS REPORT");
  console.log("=".repeat(60));

  console.log("\n── IČO Coverage ──");
  console.log(`  Total entities:     ${stats.total}`);
  console.log(`  With valid IČO:     ${stats.withIco} (${((stats.withIco / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  Without IČO:        ${stats.withoutIco} (${((stats.withoutIco / stats.total) * 100).toFixed(1)}%)`);

  console.log("\n── Entity Type ──");
  console.log(`  Legal entities:     ${stats.legalEntities} (${((stats.legalEntities / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  Physical persons:   ${stats.physicalPersons} (${((stats.physicalPersons / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  Other/unknown:      ${stats.other}`);

  console.log("\n── Status ──");
  console.log(`  Active:             ${stats.active}`);
  console.log(`  Dissolved:          ${stats.dissolved}`);

  console.log("\n── Financial Statements ──");
  console.log(`  Has závierky:       ${stats.hasFinancials} (${((stats.hasFinancials / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  No závierky:        ${stats.total - stats.hasFinancials}`);

  console.log("\n── Legal Form Distribution ──");
  const sortedForms = Object.entries(legalForms).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedForms) {
    const label = LEGAL_FORM_MAP[code] || "UNKNOWN";
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${code.padEnd(4)} ${label.padEnd(25)} ${count} (${pct}%)`);
  }

  console.log("\n── Size Category Distribution ──");
  const sortedSizes = Object.entries(sizeCats).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedSizes) {
    const label = SIZE_MAP[code] || "UNMAPPED";
    const pct = ((count / stats.total) * 100).toFixed(1);
    console.log(`  ${code.padEnd(4)} ${label.padEnd(25)} ${count} (${pct}%)`);
  }

  console.log("\n── Skip Reasons ──");
  for (const [reason, count] of Object.entries(skipReasons)) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log("\n── Verifa-relevant Companies ──");
  const relevant = stats.withIco;
  const relevantWithFs = Math.min(stats.withIco, stats.hasFinancials);
  console.log(`  Companies (valid IČO): ${relevant}`);
  console.log(`  Of which has závierky: ~${relevantWithFs}`);
  console.log(`  Conversion ratio:      ${((relevant / stats.total) * 100).toFixed(1)}% (entities → companies)`);
  console.log(`  Financial ratio:       ${((relevantWithFs / stats.total) * 100).toFixed(1)}% (entities → financials)`);
}

main().catch(console.error);
