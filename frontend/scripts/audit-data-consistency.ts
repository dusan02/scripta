/**
 * Data consistency audit: DB vs website table
 *
 * Usage: npx tsx scripts/audit-data-consistency.ts
 *
 * DB values are fetched via SSH from production PostgreSQL.
 * Web values are fetched from https://verifa.sk/firma/{ico}
 */

import { execSync } from "child_process";

const BASE_URL = "https://verifa.sk";

const ICOS = [
  "48180297", "36576531", "36622109", "36272914", "52967921",
  "50113267", "36654400", "31645895", "47019417", "52642500",
  "47525916", "51478901", "36008877", "47127406", "50491652",
  "50795902", "36006645", "47611782", "36257061", "46157964",
];

const PL_FIELDS = [
  { key: "mainActivityRevenue", label: "Tržby" },
  { key: "operatingCosts", label: "Prevádzkové náklady" },
  { key: "grossProfit", label: "Hrubá marža" },
  { key: "staffCosts", label: "Osobné náklady" },
  { key: "depreciation", label: "Odpisy" },
  { key: "profitBeforeTax", label: "Zisk pred zdanením" },
  { key: "interestExpense", label: "Úroky" },
  { key: "incomeTax", label: "Daň z príjmu" },
  { key: "netProfitLoss", label: "Zisk/Strata" },
  { key: "operatingCashFlow", label: "Cash flow" },
];

const BALANCE_FIELDS = [
  { key: "totalAssets", label: "Celkové aktíva" },
  { key: "nonCurrentAssets", label: "Neobežný majetok" },
  { key: "currentAssets", label: "Obežný majetok" },
  { key: "inventory", label: "Zásoby" },
  { key: "tradeReceivables", label: "Pohľadávky" },
  { key: "cashAndEquivalents", label: "Cash a ekvivalenty" },
  { key: "equity", label: "Vlastné imanie" },
  { key: "shareCapital", label: "Základné imanie" },
  { key: "shortTermLiabilities", label: "Krátkodobé záväzky" },
  { key: "tradePayables", label: "Záväzky z obchodného styku" },
  { key: "longTermLiabilities", label: "Dlhodobé záväzky" },
];

const ALL_FIELDS = [...PL_FIELDS, ...BALANCE_FIELDS];

function fmtDisplay(val: number | null): string {
  if (val === null) return "—";
  return val.toLocaleString("sk-SK");
}

function parseWebValue(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(/\u00a0/g, "").replace(/,/g, "").replace(/—/g, "").trim();
  if (!cleaned || cleaned === "") return null;
  const n = parseInt(cleaned, 10);
  if (isNaN(n)) return null;
  return n * 1000; // web shows in thousands
}

interface DBRow {
  year: number;
  [key: string]: number | null;
}

interface Mismatch {
  ico: string;
  companyName: string;
  year: number;
  field: string;
  dbValue: number | null;
  webValue: number | null;
  section: string;
}

function sshPsql(sql: string): string {
  // Pipe SQL via echo to avoid complex quoting through SSH + docker exec
  const escaped = sql.replace(/'/g, "'\\''");
  const cmd = `echo '${escaped}' | ssh root@verifa.sk 'docker exec -i verifa_postgres psql -U verifa -d verifa -t -A -F"|"'`;
  try {
    return execSync(cmd, { timeout: 15000, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
  } catch (e: any) {
    return "";
  }
}

function getDBData(ico: string): { stmts: DBRow[]; companyName: string } {
  const fields = ALL_FIELDS.map(f => `"${f.key}"`).join(", ");
  const sql = `SELECT year, ${fields} FROM "FinancialStatement" WHERE "companyIco"='${ico}' ORDER BY year DESC LIMIT 5;`;
  const nameSql = `SELECT name FROM "Company" WHERE ico='${ico}';`;

  let companyName = ico;
  const nameOut = sshPsql(nameSql);
  if (nameOut) companyName = nameOut;

  const output = sshPsql(sql);
  if (!output) return { stmts: [], companyName };

  const stmts: DBRow[] = output.split("\n").map(line => {
    const parts = line.split("|");
    const row: DBRow = { year: parseInt(parts[0], 10) };
    ALL_FIELDS.forEach((f, i) => {
      const val = parts[i + 1];
      row[f.key] = val && val !== "" ? parseFloat(val) : null;
    });
    return row;
  });

  return { stmts: stmts.sort((a, b) => a.year - b.year), companyName };
}

async function auditCompany(ico: string): Promise<{ mismatches: Mismatch[]; stmts: DBRow[]; webAvailable: boolean; webRowsFound: number }> {
  const { stmts, companyName } = getDBData(ico);

  if (stmts.length === 0) {
    return { mismatches: [], stmts: [], webAvailable: false, webRowsFound: 0 };
  }

  const url = `${BASE_URL}/firma/${ico}`;
  let webAvailable = false;
  let html = "";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      html = await res.text();
      webAvailable = true;
    }
  } catch (e) {
    console.error(`  [${ico}] Failed to fetch website: ${(e as Error).message}`);
  }

  if (!webAvailable) {
    return { mismatches: [], stmts, webAvailable: false, webRowsFound: 0 };
  }

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

  const webRows: Map<string, (number | null)[]> = new Map();

  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1];
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const text = cellMatch[1]
          .replace(/<[^>]*>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .trim();
        cells.push(text);
      }
      if (cells.length < 2) continue;
      const label = cells[0].trim();
      if (!label || label.includes("Ukazovateľ") || label.includes("ukazovateľ")) continue;
      const values = cells.slice(1).map(v => parseWebValue(v));
      webRows.set(label, values);
    }
  }

  const mismatches: Mismatch[] = [];

  const checkField = (field: { key: string; label: string }, section: string) => {
    const webValues = webRows.get(field.label);
    if (!webValues) {
      const allNull = stmts.every(s => s[field.key] === null);
      if (!allNull) {
        for (const s of stmts) {
          if (s[field.key] !== null) {
            mismatches.push({
              ico, companyName, year: s.year, field: field.label,
              dbValue: s[field.key], webValue: null, section,
            });
          }
        }
      }
      return;
    }

    for (let i = 0; i < stmts.length; i++) {
      const dbVal = stmts[i][field.key];
      const webVal = webValues[i] ?? null;

      if (dbVal === null && webVal === null) continue;
      if ((dbVal === null) !== (webVal === null)) {
        mismatches.push({ ico, companyName, year: stmts[i].year, field: field.label, dbValue: dbVal, webValue: webVal, section });
        continue;
      }
      if (dbVal !== null && webVal !== null) {
        const diff = Math.abs(dbVal - webVal);
        const tolerance = Math.max(Math.abs(dbVal) * 0.05, 1000);
        if (diff > tolerance) {
          mismatches.push({ ico, companyName, year: stmts[i].year, field: field.label, dbValue: dbVal, webValue: webVal, section });
        }
      }
    }
  };

  for (const field of PL_FIELDS) checkField(field, "P&L");
  for (const field of BALANCE_FIELDS) checkField(field, "Balance");

  return { mismatches, stmts, webAvailable, webRowsFound: webRows.size };
}

async function main() {
  console.log("=== Data Consistency Audit: DB vs Website Table ===\n");
  console.log(`Checking ${ICOS.length} companies...\n`);

  let totalMismatches = 0;
  const allMismatches: Mismatch[] = [];

  for (const ico of ICOS) {
    process.stdout.write(`[${ico}] `);
    const result = await auditCompany(ico);

    if (!result.webAvailable) {
      console.log("WEBSITE UNAVAILABLE");
      continue;
    }

    const stmtYears = result.stmts.map(s => s.year).join(", ");
    console.log(`${result.stmts.length} stmts (${stmtYears}) | web rows: ${result.webRowsFound} | mismatches: ${result.mismatches.length}`);

    if (result.mismatches.length > 0) {
      for (const m of result.mismatches) {
        console.log(`  X ${m.section} | ${m.field} | ${m.year} | DB=${fmtDisplay(m.dbValue)} | WEB=${fmtDisplay(m.webValue)}`);
      }
      allMismatches.push(...result.mismatches);
      totalMismatches += result.mismatches.length;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Companies checked: ${ICOS.length}`);
  console.log(`Total mismatches: ${totalMismatches}`);

  if (allMismatches.length > 0) {
    console.log(`\n=== Mismatch Details ===`);
    const byField = new Map<string, number>();
    for (const m of allMismatches) {
      const key = `${m.section}/${m.field}`;
      byField.set(key, (byField.get(key) || 0) + 1);
    }
    console.log("\nBy field:");
    for (const [field, count] of [...byField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${field}: ${count}`);
    }

    const byCompany = new Map<string, number>();
    for (const m of allMismatches) {
      const key = `${m.ico} (${m.companyName})`;
      byCompany.set(key, (byCompany.get(key) || 0) + 1);
    }
    console.log("\nBy company:");
    for (const [company, count] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${company}: ${count}`);
    }
  } else {
    console.log("\nAll values match between DB and website!");
  }
}

main().catch(console.error);
