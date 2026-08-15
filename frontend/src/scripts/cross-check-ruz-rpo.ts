#!/usr/bin/env npx tsx
/**
 * Cross-check RÚZ ↔ RPO data in the database.
 *
 * Reports:
 * 1. Source coverage (RPO only, RÚZ only, both, neither)
 * 2. Data completeness per source
 * 3. Field-level discrepancies between RPO and RÚZ
 * 4. Companies in DB not matched by RÚZ
 * 5. Status distribution
 * 6. NACE code coverage
 *
 * Usage:
 *   npx tsx src/scripts/cross-check-ruz-rpo.ts
 *   npx tsx src/scripts/cross-check-ruz-rpo.ts --sample=100   # detailed sample of N discrepancies
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const sampleArg = args.find((a) => a.startsWith("--sample="));
  const sampleSize = sampleArg ? parseInt(sampleArg.split("=")[1]) : 50;

  console.log("RÚZ ↔ RPO Cross-Check Report");
  console.log("=".repeat(70));
  console.log();

  // ── 1. Source coverage ──────────────────────────────────────────────────────
  console.log("── 1. Source Coverage ──");

  const totalCompanies = await prisma.company.count();
  const withRpo = await prisma.company.count({ where: { orsrSyncedAt: { not: null } } });
  const withRuz = await prisma.company.count({ where: { ruzSyncedAt: { not: null } } });
  const withBoth = await prisma.company.count({
    where: { AND: [{ orsrSyncedAt: { not: null } }, { ruzSyncedAt: { not: null } }] },
  });
  const withNeither = await prisma.company.count({
    where: { AND: [{ orsrSyncedAt: null }, { ruzSyncedAt: null }] },
  });
  const rpoOnly = withRpo - withBoth;
  const ruzOnly = withRuz - withBoth;

  console.log(`  Total companies in DB:     ${totalCompanies.toLocaleString("sk")}`);
  console.log(`  RPO synced (orsrSyncedAt): ${withRpo.toLocaleString("sk")} (${((withRpo / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  RÚZ synced (ruzSyncedAt):  ${withRuz.toLocaleString("sk")} (${((withRuz / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  Both sources:              ${withBoth.toLocaleString("sk")} (${((withBoth / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  RPO only:                  ${rpoOnly.toLocaleString("sk")}`);
  console.log(`  RÚZ only:                  ${ruzOnly.toLocaleString("sk")}`);
  console.log(`  Neither:                   ${withNeither.toLocaleString("sk")}`);
  console.log();

  // ── 2. Status distribution ──────────────────────────────────────────────────
  console.log("── 2. Status Distribution ──");

  const statusGroups = await prisma.company.groupBy({
    by: ["status"],
    _count: true,
    orderBy: { _count: { status: "desc" } },
  });

  for (const s of statusGroups) {
    const pct = ((s._count / totalCompanies) * 100).toFixed(1);
    console.log(`  ${String(s.status).padEnd(20)} ${s._count.toLocaleString("sk")} (${pct}%)`);
  }
  console.log();

  // ── 3. Data completeness ────────────────────────────────────────────────────
  console.log("── 3. Data Completeness (all companies) ──");

  const fields = [
    "name", "legalForm", "city", "street", "zipCode", "country",
    "establishedAt", "naceCode", "sizeCategory", "employeeCount",
    "ownershipType", "ruzEntityId", "businessActivity", "signingAuthority",
    "shareCapital",
  ] as const;

  for (const field of fields) {
    const filled = await prisma.company.count({
      where: { [field]: { not: null } },
    });
    const pct = ((filled / totalCompanies) * 100).toFixed(1);
    const bar = "█".repeat(Math.round((filled / totalCompanies) * 30));
    console.log(`  ${field.padEnd(20)} ${filled.toLocaleString("sk").padStart(8)} / ${totalCompanies.toLocaleString("sk")} (${pct}%) ${bar}`);
  }
  console.log();

  // ── 4. Legal form distribution ──────────────────────────────────────────────
  console.log("── 4. Legal Form Distribution ──");

  const legalFormGroups = await prisma.company.groupBy({
    by: ["legalForm"],
    _count: true,
    orderBy: { _count: { legalForm: "desc" } },
  });

  for (const lf of legalFormGroups.slice(0, 15)) {
    const pct = ((lf._count / totalCompanies) * 100).toFixed(1);
    console.log(`  ${String(lf.legalForm).padEnd(25)} ${lf._count.toLocaleString("sk")} (${pct}%)`);
  }
  if (legalFormGroups.length > 15) {
    console.log(`  ... and ${legalFormGroups.length - 15} more`);
  }
  console.log();

  // ── 5. NACE code coverage ───────────────────────────────────────────────────
  console.log("── 5. NACE Code Coverage (from RÚZ) ──");

  const withNace = await prisma.company.count({ where: { naceCode: { not: null } } });
  const withoutNace = await prisma.company.count({ where: { naceCode: null } });
  console.log(`  With NACE:    ${withNace.toLocaleString("sk")} (${((withNace / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  Without NACE: ${withoutNace.toLocaleString("sk")} (${((withoutNace / totalCompanies) * 100).toFixed(1)}%)`);

  const naceGroups = await prisma.company.groupBy({
    by: ["naceCode"],
    where: { naceCode: { not: null } },
    _count: true,
    orderBy: { _count: { naceCode: "desc" } },
  });

  console.log(`  Top 10 NACE codes:`);
  for (const n of naceGroups.slice(0, 10)) {
    console.log(`    ${String(n.naceCode).padEnd(10)} ${n._count.toLocaleString("sk")}`);
  }
  console.log();

  // ── 6. Size category distribution ───────────────────────────────────────────
  console.log("── 6. Size Category Distribution (from RÚZ) ──");

  const sizeGroups = await prisma.company.groupBy({
    by: ["sizeCategory"],
    where: { sizeCategory: { not: null } },
    _count: true,
    orderBy: { _count: { sizeCategory: "desc" } },
  });

  for (const s of sizeGroups.slice(0, 15)) {
    console.log(`  ${String(s.sizeCategory).padEnd(30)} ${s._count.toLocaleString("sk")}`);
  }
  console.log();

  // ── 7. Ownership type distribution ──────────────────────────────────────────
  console.log("── 7. Ownership Type Distribution (from RÚZ) ──");

  const ownershipGroups = await prisma.company.groupBy({
    by: ["ownershipType"],
    where: { ownershipType: { not: null } },
    _count: true,
    orderBy: { _count: { ownershipType: "desc" } },
  });

  for (const o of ownershipGroups) {
    console.log(`  ${String(o.ownershipType).padEnd(30)} ${o._count.toLocaleString("sk")}`);
  }
  console.log();

  // ── 8. Companies with RÚZ but missing key RPO fields ────────────────────────
  console.log("── 8. Companies with RÚZ but missing key RPO fields ──");

  const ruzMissingName = await prisma.company.count({
    where: { AND: [{ ruzSyncedAt: { not: null } }, { name: null }] },
  });
  const ruzMissingAddress = await prisma.company.count({
    where: { AND: [{ ruzSyncedAt: { not: null } }, { OR: [{ city: null }, { street: null }] }] },
  });
  const ruzMissingLegalForm = await prisma.company.count({
    where: { AND: [{ ruzSyncedAt: { not: null } }, { legalForm: null }] },
  });
  const ruzMissingEstablished = await prisma.company.count({
    where: { AND: [{ ruzSyncedAt: { not: null } }, { establishedAt: null }] },
  });

  console.log(`  Missing name:         ${ruzMissingName.toLocaleString("sk")}`);
  console.log(`  Missing address:      ${ruzMissingAddress.toLocaleString("sk")}`);
  console.log(`  Missing legal form:   ${ruzMissingLegalForm.toLocaleString("sk")}`);
  console.log(`  Missing established:  ${ruzMissingEstablished.toLocaleString("sk")}`);
  console.log();

  // ── 9. Companies with RPO but missing key RÚZ fields ────────────────────────
  console.log("── 9. Companies with RPO but missing key RÚZ fields ──");

  const rpoMissingNace = await prisma.company.count({
    where: { AND: [{ orsrSyncedAt: { not: null } }, { naceCode: null }] },
  });
  const rpoMissingSize = await prisma.company.count({
    where: { AND: [{ orsrSyncedAt: { not: null } }, { sizeCategory: null }] },
  });
  const rpoMissingRuzId = await prisma.company.count({
    where: { AND: [{ orsrSyncedAt: { not: null } }, { ruzEntityId: null }] },
  });

  console.log(`  Missing NACE:         ${rpoMissingNace.toLocaleString("sk")}`);
  console.log(`  Missing size cat:     ${rpoMissingSize.toLocaleString("sk")}`);
  console.log(`  Missing ruzEntityId:  ${rpoMissingRuzId.toLocaleString("sk")}`);
  console.log();

  // ── 10. CompanyPerson coverage (fast: pg_class.reltuples + indexed count) ───
  console.log("── 10. CompanyPerson Coverage ──");

  // Fast estimate from PostgreSQL stats (no seq scan)
  const personEstimate = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'CompanyPerson'
  `;
  const totalPersons = Number(personEstimate[0]?.count ?? 0);

  // Count companies with at least one person — uses EXISTS + index on companyIco
  const companiesWithPersonsRaw = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "Company" c
    WHERE EXISTS (SELECT 1 FROM "CompanyPerson" p WHERE p."companyIco" = c.ico)
  `;
  const companiesWithPersons = Number(companiesWithPersonsRaw[0]?.count ?? 0);
  const companiesWithoutPersons = totalCompanies - companiesWithPersons;

  console.log(`  Total persons (est.):    ${totalPersons.toLocaleString("sk")}`);
  console.log(`  Companies with persons:  ${companiesWithPersons.toLocaleString("sk")} (${((companiesWithPersons / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  Companies without:       ${companiesWithoutPersons.toLocaleString("sk")} (${((companiesWithoutPersons / totalCompanies) * 100).toFixed(1)}%)`);

  // Role distribution via raw SQL (uses index on role)
  const roleGroupsRaw = await prisma.$queryRaw<{ role: string; count: bigint }[]>`
    SELECT role, COUNT(*)::bigint AS count FROM "CompanyPerson" GROUP BY role ORDER BY count DESC
  `;
  console.log(`  By role:`);
  for (const r of roleGroupsRaw) {
    console.log(`    ${r.role.padEnd(20)} ${Number(r.count).toLocaleString("sk")}`);
  }
  console.log();

  // ── 11. Financial statement denormalized fields ─────────────────────────────
  console.log("── 11. Denormalized Financial Fields ──");

  const withLatestYear = await prisma.company.count({ where: { latestYear: { not: null } } });
  const withRevenue = await prisma.company.count({ where: { latestRevenue: { not: null } } });
  const withProfit = await prisma.company.count({ where: { latestProfit: { not: null } } });
  const withAssets = await prisma.company.count({ where: { latestAssets: { not: null } } });
  const withEquity = await prisma.company.count({ where: { latestEquity: { not: null } } });

  console.log(`  latestYear:    ${withLatestYear.toLocaleString("sk")} (${((withLatestYear / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  latestRevenue: ${withRevenue.toLocaleString("sk")} (${((withRevenue / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  latestProfit:  ${withProfit.toLocaleString("sk")} (${((withProfit / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  latestAssets:  ${withAssets.toLocaleString("sk")} (${((withAssets / totalCompanies) * 100).toFixed(1)}%)`);
  console.log(`  latestEquity:  ${withEquity.toLocaleString("sk")} (${((withEquity / totalCompanies) * 100).toFixed(1)}%)`);
  console.log();

  // ── 12. Sample: RÚZ-active companies without financials denormalized ────────
  console.log(`── 12. Sample: ruz_active without denormalized financials (first ${sampleSize}) ──`);

  const ruzActiveNoFinancials = await prisma.company.findMany({
    where: {
      AND: [
        { status: "ruz_active" },
        { OR: [{ latestYear: null }, { latestRevenue: null }] },
      ],
    },
    select: { ico: true, name: true, legalForm: true, ruzEntityId: true, latestYear: true, status: true },
    take: sampleSize,
  });

  console.log(`  Found: ${ruzActiveNoFinancials.length} (showing first ${sampleSize})`);
  for (const c of ruzActiveNoFinancials.slice(0, 10)) {
    console.log(`    ${c.ico} | ${c.name?.substring(0, 40) || "????"} | ruzId=${c.ruzEntityId} | latestYear=${c.latestYear ?? "null"}`);
  }
  if (ruzActiveNoFinancials.length > 10) {
    console.log(`    ... and ${ruzActiveNoFinancials.length - 10} more`);
  }
  console.log();

  // ── 13. Sample: Companies not matched by RÚZ ────────────────────────────────
  console.log(`── 13. Sample: Companies not synced from RÚZ (first ${sampleSize}) ──`);

  const notInRuz = await prisma.company.findMany({
    where: { ruzSyncedAt: null },
    select: { ico: true, name: true, legalForm: true, orsrSyncedAt: true, status: true },
    take: sampleSize,
  });

  console.log(`  Total not in RÚZ: ${withNeither + rpoOnly}`);
  for (const c of notInRuz.slice(0, 10)) {
    console.log(`    ${c.ico} | ${c.name?.substring(0, 40) || "????"} | ${c.legalForm || "?"} | status=${c.status || "null"}`);
  }
  if (notInRuz.length > 10) {
    console.log(`    ... and ${notInRuz.length - 10} more in sample`);
  }
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Total companies:        ${totalCompanies.toLocaleString("sk")}`);
  console.log(`  RPO coverage:           ${((withRpo / totalCompanies) * 100).toFixed(1)}%`);
  console.log(`  RÚZ coverage:           ${((withRuz / totalCompanies) * 100).toFixed(1)}%`);
  console.log(`  Both sources:           ${((withBoth / totalCompanies) * 100).toFixed(1)}%`);
  console.log(`  ruz_active:             ${statusGroups.find(s => s.status === "ruz_active")?._count.toLocaleString("sk") ?? 0}`);
  console.log(`  With persons:           ${((companiesWithPersons / totalCompanies) * 100).toFixed(1)}%`);
  console.log(`  With denorm. financials:${((withLatestYear / totalCompanies) * 100).toFixed(1)}%`);
  console.log(`  With NACE:              ${((withNace / totalCompanies) * 100).toFixed(1)}%`);
  console.log("=".repeat(70));
}

main().catch(console.error).finally(() => prisma.$disconnect());
