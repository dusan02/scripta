// Test: RÚZ API parser — verifies correct row mapping for šablóna 699
// Run: npx tsx src/lib/__tests__/ruz-parser.test.ts

const RUZ_API_TEST = "https://www.registeruz.sk/cruz-public/api";
const UA_TEST = "Verifa.sk/1.0 (+https://verifa.sk)";

const ACTIV_OFFSET = 1;
const PASIV_OFFSET = 1;
const INCOME_OFFSET = 1;

function toFloat(val: any): number | null {
  if (val === null || val === undefined || val === "" || val === " ") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    let c = val.trim();
    if (!c) return null;
    let neg = false;
    if (c.startsWith("(") && c.endsWith(")")) { neg = true; c = c.slice(1, -1).trim(); }
    c = c.replace(/[\s\xa0]/g, "");
    if (c.includes(",") && c.includes(".")) {
      if (c.lastIndexOf(",") > c.lastIndexOf(".")) c = c.replace(/\./g, "").replace(",", ".");
      else c = c.replace(/,/g, "");
    } else if (c.includes(",")) c = c.replace(",", ".");
    if ((c.match(/\./g) || []).length > 1) {
      const p = c.split("."); c = p.slice(0, -1).join("") + "." + p[p.length - 1];
    }
    const r = parseFloat(c);
    if (isNaN(r)) return null;
    return neg ? -r : r;
  }
  return null;
}

function getRow(tables: any[], idx: number, cislo: number, offset: number, cols: number): any[] | null {
  if (idx >= tables.length) return null;
  const data = tables[idx]?.data;
  if (!data || !Array.isArray(data)) return null;
  const i = cislo - offset;
  if (i < 0 || i >= data.length) return null;
  const row = data[i];
  if (Array.isArray(row)) return row;
  if (cols > 0) {
    const s = i * cols;
    if (s + cols <= data.length) return data.slice(s, s + cols);
  }
  return null;
}

function activVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 0, r, ACTIV_OFFSET, 1);
  if (!row) return null;
  return toFloat(row[0]);
}

function pasivVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 1, r, PASIV_OFFSET, 1);
  if (!row) return null;
  return toFloat(row[0]);
}

function incomeVal(t: any[], r: number, cur = true): number | null {
  const row = getRow(t, 2, r, INCOME_OFFSET, 1);
  if (!row) return null;
  return toFloat(row[0]);
}

function identifyTables(tables: any[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (let i = 0; i < tables.length; i++) {
    const n = (tables[i]?.nazov?.sk || "").toLowerCase();
    if (n.includes("strana akt") || n.includes("aktív") || (n.includes("akt") && !n.includes("pas"))) r.aktiv = i;
    else if (n.includes("strana pas") || n.includes("pasív") || n.includes("pas")) r.pasiv = i;
    else if (n.includes("ziskov a str") || n.includes("profit and loss")) r.income = i;
  }
  return r;
}

async function ruzGet(endpoint: string, params: Record<string, string | number>): Promise<any | null> {
  const url = new URL(`${RUZ_API_TEST}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const r = await fetch(url.toString(), { headers: { "User-Agent": UA_TEST }, signal: AbortSignal.timeout(15000) });
    if (r.ok) return await r.json();
    return null;
  } catch { return null; }
}

// ── Test runner ──

let passed = 0;
let failed = 0;

function assert(label: string, actual: any, expected: any) {
  const a = actual === null ? null : Number(actual);
  const e = expected === null ? null : Number(expected);
  if (a === e) {
    console.log(`  ✅ ${label}: ${a}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: got ${a}, expected ${e}`);
    failed++;
  }
}

function assertNonNull(label: string, actual: any) {
  if (actual !== null && actual !== undefined) {
    console.log(`  ✅ ${label}: ${actual} (non-null)`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: got null, expected non-null`);
    failed++;
  }
}

async function testFortuna2025() {
  console.log("\n=== Test: FORTUNA SK (00684881) — rok 2025, šablóna 699 ===\n");

  // Fetch entity
  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico: "00684881", "max-zaznamov": 10 });
  if (!eids?.id?.length) { console.log("❌ Cannot find entity"); failed++; return; }
  const entity = await ruzGet("uctovna-jednotka", { id: eids.id[0] });
  if (!entity) { console.log("❌ Cannot fetch entity"); failed++; return; }

  // Find 2025 zavierka
  const zids = entity.idUctovnychZavierok || [];
  let zavierka2025: any = null;
  for (const zid of zids.sort((a: number, b: number) => b - a)) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (z?.obdobieDo?.startsWith("2025")) { zavierka2025 = z; break; }
  }
  if (!zavierka2025) { console.log("❌ Cannot find 2025 zavierka"); failed++; return; }

  // Fetch výkazy
  const allTables: any[] = [];
  for (const vid of zavierka2025.idUctovnychVykazov || []) {
    const v = await ruzGet("uctovny-vykaz", { id: vid });
    if (v?.obsah?.tabulky?.length) allTables.push(...v.obsah.tabulky);
  }
  if (!allTables.length) { console.log("❌ No tables in výkazy"); failed++; return; }

  const tm = identifyTables(allTables);
  if (tm.aktiv === undefined || tm.pasiv === undefined) { console.log("❌ Cannot identify aktív/pasív tables"); failed++; return; }

  const ordered = [allTables[tm.aktiv], allTables[tm.pasiv]];
  if (tm.income !== undefined) ordered.push(allTables[tm.income]);
  const hasIncome = ordered.length > 2;

  console.log("Tables identified:");
  console.log(`  aktív=${tm.aktiv}, pasív=${tm.pasiv}, income=${tm.income}, hasIncome=${hasIncome}`);
  console.log(`  aktív rows=${ordered[0].data.length}, pasív rows=${ordered[1].data.length}`);
  if (hasIncome) console.log(`  income rows=${ordered[2].data.length}`);
  console.log();

  // ── AKTÍV tests ──
  console.log("── AKTÍV (Strana aktív) ──");
  assert("totalAssets (row 1)", activVal(ordered, 1), 137305528);
  assert("tradeReceivables (row 54)", activVal(ordered, 54), 4079096);
  assert("cashAndEquivalents (row 72)", activVal(ordered, 72), 110607);
  console.log();

  // ── PASÍV tests ──
  console.log("── PASÍV (Strana pasív) ──");
  assert("equity (row 3)", pasivVal(ordered, 3), 39899126);
  assert("shortTermLiabilities (row 85)", pasivVal(ordered, 85), 49887253);
  assert("tradePayables (row 87)", pasivVal(ordered, 87), 24077849);
  assert("longTermLiabilities (row 89)", pasivVal(ordered, 89), 13496268);
  console.log();

  // ── INCOME tests ──
  if (!hasIncome) { console.log("⚠️ No income table — skipping income tests\n"); return; }

  console.log("── INCOME (Výkaz ziskov a strát) ──");
  assert("mainActivityRevenue/trzby (row 1)", incomeVal(ordered, 1), 172359264);
  assert("cogs (row 10)", incomeVal(ordered, 10), 152927764);
  assert("staffCosts (row 15)", incomeVal(ordered, 15), 10384);
  assert("depreciation (row 27)", incomeVal(ordered, 27), 60288580);
  assert("grossProfit (row 28)", incomeVal(ordered, 28), 55700681);
  assert("interestExpense (row 49)", incomeVal(ordered, 49), 240945);
  assert("profitBeforeTax (row 111)", incomeVal(ordered, 111), 49114061);
  assert("incomeTax (row 113)", incomeVal(ordered, 113), 11805505);
  assert("netProfitLoss (row 121)", incomeVal(ordered, 121), 37308556);
  console.log();

  // ── Cross-checks ──
  console.log("── Cross-checks ──");
  const pbt = incomeVal(ordered, 111);
  const tax = incomeVal(ordered, 113);
  const net = incomeVal(ordered, 121);
  if (pbt !== null && tax !== null && net !== null) {
    assert("profitBeforeTax - incomeTax == netProfitLoss", pbt - tax, net);
  }
  console.log();
}

async function testSlovSporitelna2025() {
  console.log("\n=== Test: Slovenská sporiteľňa (00151653) — rok 2025 ===\n");

  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico: "00151653", "max-zaznamov": 10 });
  if (!eids?.id?.length) { console.log("❌ Cannot find entity"); failed++; return; }
  const entity = await ruzGet("uctovna-jednotka", { id: eids.id[0] });
  if (!entity) { console.log("❌ Cannot fetch entity"); failed++; return; }

  const zids = entity.idUctovnychZavierok || [];
  let zavierka2025: any = null;
  for (const zid of zids.sort((a: number, b: number) => b - a)) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (z?.obdobieDo?.startsWith("2025")) { zavierka2025 = z; break; }
  }
  if (!zavierka2025) { console.log("❌ Cannot find 2025 zavierka"); failed++; return; }

  const allTables: any[] = [];
  for (const vid of zavierka2025.idUctovnychVykazov || []) {
    const v = await ruzGet("uctovny-vykaz", { id: vid });
    if (v?.obsah?.tabulky?.length) allTables.push(...v.obsah.tabulky);
  }
  if (!allTables.length) { console.log("❌ No tables in výkazy"); failed++; return; }

  const tm = identifyTables(allTables);
  if (tm.aktiv === undefined || tm.pasiv === undefined) { console.log("❌ Cannot identify tables"); failed++; return; }

  const ordered = [allTables[tm.aktiv], allTables[tm.pasiv]];
  if (tm.income !== undefined) ordered.push(allTables[tm.income]);
  const hasIncome = ordered.length > 2;

  console.log("Tables identified:");
  console.log(`  aktív=${tm.aktiv}, pasív=${tm.pasiv}, income=${tm.income}, hasIncome=${hasIncome}`);
  console.log(`  aktív rows=${ordered[0].data.length}, pasív rows=${ordered[1].data.length}`);
  if (hasIncome) console.log(`  income rows=${ordered[2].data.length}`);
  console.log();

  // Just verify non-null for key fields (different šablóna may have different exact values)
  console.log("── Key field checks (non-null) ──");
  assertNonNull("totalAssets", activVal(ordered, 1));
  assertNonNull("equity", pasivVal(ordered, 3));
  if (hasIncome) {
    assertNonNull("mainActivityRevenue", incomeVal(ordered, 1));
    assertNonNull("incomeTax", incomeVal(ordered, 113));
    assertNonNull("netProfitLoss", incomeVal(ordered, 121));
    assertNonNull("profitBeforeTax", incomeVal(ordered, 111));
  }
  console.log();
}

async function testContinental() {
  console.log("\n=== Test: Continental Tires (36709557) — Verejné prílohy ===\n");

  const eids = await ruzGet("uctovne-jednotky", { "zmenene-od": "2000-01-01", ico: "36709557", "max-zaznamov": 10 });
  if (!eids?.id?.length) { console.log("❌ Cannot find entity"); failed++; return; }
  const entity = await ruzGet("uctovna-jednotka", { id: eids.id[0] });
  if (!entity) { console.log("❌ Cannot fetch entity"); failed++; return; }

  const zids = entity.idUctovnychZavierok || [];
  let foundTables = false;
  for (const zid of zids.sort((a: number, b: number) => b - a).slice(0, 3)) {
    const z = await ruzGet("uctovna-zavierka", { id: zid });
    if (!z) continue;
    for (const vid of z.idUctovnychVykazov || []) {
      const v = await ruzGet("uctovny-vykaz", { id: vid });
      if (v?.obsah?.tabulky?.length) { foundTables = true; break; }
    }
    if (foundTables) break;
  }

  if (!foundTables) {
    console.log("  ✅ Confirmed: Continental has 'Verejné prílohy' — no structured tables (expected)");
    passed++;
  } else {
    console.log("  ⚠️ Continental now has structured tables — re-test parsing");
  }
  console.log();
}

// ── Main ──
async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  RÚZ Parser Test Suite                   ║");
  console.log("╚══════════════════════════════════════════╝");

  await testFortuna2025();
  await testSlovSporitelna2025();
  await testContinental();

  console.log("╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed` + " ".repeat(Math.max(0, 24 - `${passed} passed, ${failed} failed`.length)) + "║");
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) process.exit(1);
}

main().catch(console.error);
